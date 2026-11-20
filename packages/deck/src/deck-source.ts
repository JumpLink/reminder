/**
 * Nextcloud Deck as a board (docs/adr/0007); writes per docs/adr/0013.
 *
 * Mapping onto the port:
 *   · a stack is a column, in the server's `order` (ties by id); Deck has no "finished" stack, so
 *     `SourceColumn.closed` is null and `rules.ts` decides the lane from the title,
 *   · `assignedUsers[].participant.uid` is an assignee, `isMe` when it equals the uid the server
 *     reports for the credentials (`whoAmI`) — never a comparison of display names,
 *   · Deck has no watching, so `hasWatchers: false` and every `watchedByMe` is null,
 *   · a card is closed when it is archived or marked done; archived cards only come from the
 *     separate `stacks/archived` endpoint and are fetched only for `includeClosed`,
 *   · the token is the ETag of `GET boards/{id}/stacks`. Deck folds every child change (cards,
 *     labels, assignments) into the board's ETag, so "unchanged" costs exactly one 304 request.
 *
 * Two stacks may share a title; the later ones read "Title (2)" so a column name stays unique and
 * a card's `sourceColumn` still finds its column.
 */

import {
  HttpClient,
  NotFoundError,
  ResponseFormatError,
  type HostLimiter,
  type HttpAuth,
} from '@gjsify/http-client';
import {
  _,
  boardNotFound,
  ConflictError,
  filterMine,
  fmt,
  InputError,
  type BoardRef,
  type BoardSource,
  type Card,
  type CardLabel,
  type CardWrite,
  type CardPage,
  type CardQuery,
  type SourceColumn,
  type SourceInfo,
  type SourceUser,
} from '@reminder/core';

export interface DeckSourceOptions {
  /** `SourceInfo.id`; default `deck`. */
  id?: string;
  /** The Nextcloud server root, e.g. `https://cloud.example.org/`. No credentials in it. */
  baseUrl: string;
  /** An app password is the right choice; the login name is not necessarily the Deck uid. */
  auth: HttpAuth;
  /** Skips the `ocs/v2.php/cloud/user` lookup when the Deck uid is already known. */
  identity?: { id: string; displayName?: string | null };
  timeoutMs?: number;
  limiter?: HostLimiter;
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch;
}

interface RawUser {
  uid?: string;
  primaryKey?: string;
  displayname?: string;
}

interface RawCard {
  id: number;
  title?: string;
  labels?: { title?: string; color?: string }[] | null;
  assignedUsers?: { participant?: RawUser }[] | null;
  archived?: boolean;
  done?: string | null;
  duedate?: string | null;
  lastModified?: number;
  deletedAt?: number;
  order?: number;
  ETag?: string;
  stackId?: number;
  description?: string | null;
  type?: string;
  owner?: string | { uid?: string; primaryKey?: string } | null;
}

interface RawStack {
  id: number;
  title: string;
  order?: number;
  deletedAt?: number;
  cards?: RawCard[] | null;
}

interface RawBoard {
  id: number;
  title: string;
  archived?: boolean;
  deletedAt?: number;
}

const API = 'index.php/apps/deck/api/v1.0/';
const APP = 'index.php/apps/deck/';

function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function instant(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : isoSeconds(ms);
}

/**
 * Deck only stores timestamps. A due date at exactly midnight UTC is how this adapter stores a
 * date-only due (see `toDeckDue`), so it reads back as the date it was written as.
 */
function due(value: string | null | undefined): string | null {
  const at = instant(value);
  return at?.endsWith('T00:00:00Z') ? at.slice(0, 10) : at;
}

/** The `duedate` Deck takes: a date becomes midnight UTC, other shapes pass through. */
function toDeckDue(value: string | null): string | null {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+00:00` : value;
}

function fromUnix(seconds: number | undefined): string | null {
  return typeof seconds === 'number' && seconds > 0 ? isoSeconds(seconds * 1000) : null;
}

function text(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/** Stacks in the server's order, deleted ones dropped; ties fall to the id so the order is total. */
function orderedStacks(stacks: RawStack[]): RawStack[] {
  return stacks
    .filter((stack) => !(stack.deletedAt && stack.deletedAt > 0))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id);
}

/** Stack id -> unique column name. */
function columnNames(stacks: RawStack[]): Map<number, string> {
  const names = new Map<number, string>();
  const used = new Set<string>();
  for (const stack of stacks) {
    let name = stack.title;
    for (let n = 2; used.has(name); n++) name = `${stack.title} (${n})`;
    used.add(name);
    names.set(stack.id, name);
  }
  return names;
}

export function createDeckBoardSource(options: DeckSourceOptions): BoardSource {
  const id = options.id ?? 'deck';
  const root = new URL(options.baseUrl);
  if (!root.pathname.endsWith('/')) root.pathname += '/';
  root.search = '';
  root.hash = '';

  const client = new HttpClient({
    baseUrl: new URL(API, root).href,
    auth: options.auth,
    headers: { 'OCS-APIRequest': 'true', 'Content-Type': 'application/json' },
    timeoutMs: options.timeoutMs,
    limiter: options.limiter,
    fetch: options.fetch,
  });
  const info: SourceInfo = { id, type: 'deck', canWrite: true, hasWatchers: false, changeToken: true };
  const appUrl = (path: string): string => new URL(`${APP}${path}`, root).href;

  let identity: Promise<SourceUser> | undefined;

  async function lookupMe(): Promise<SourceUser> {
    if (options.identity) {
      return { id: options.identity.id, displayName: options.identity.displayName ?? null, isMe: true };
    }
    // Not part of the Deck API: the standard Nextcloud OCS "current user" endpoint.
    const url = new URL('ocs/v2.php/cloud/user', root).href;
    const result = await client.getJson<{
      ocs?: { data?: { id?: string; displayname?: string; 'display-name'?: string } };
    }>(url, { query: { format: 'json' } });
    const data = result.status === 'ok' ? result.data.ocs?.data : undefined;
    if (!data?.id) {
      throw new ResponseFormatError(_('Deck did not say who is signed in'), { status: 200, url: new URL(root).origin });
    }
    return { id: data.id, displayName: text(data['display-name'] ?? data.displayname), isMe: true };
  }

  function whoAmI(): Promise<SourceUser> {
    identity ??= lookupMe().catch((err: unknown) => {
      identity = undefined;
      throw err;
    });
    return identity.then((me) => ({ ...me }));
  }

  function boardUrl(boardId: string): string {
    return appUrl(`board/${encodeURIComponent(boardId)}`);
  }

  async function stacksOf(
    board: BoardRef,
    suffix: string,
    etag?: string,
  ): Promise<{ stacks: RawStack[]; etag: string | undefined } | 'unchanged'> {
    const path = `boards/${encodeURIComponent(board.id)}/stacks${suffix}`;
    try {
      const result = await client.getJson<unknown>(path, { etag });
      if (result.status === 'unchanged') return 'unchanged';
      if (!Array.isArray(result.data)) {
        throw new ResponseFormatError(_('Deck did not return a list of stacks'), { status: 200, url: path });
      }
      return { stacks: result.data as RawStack[], etag: result.etag };
    } catch (err) {
      if (err instanceof NotFoundError) throw boardNotFound(board.id);
      throw err;
    }
  }

  function toCard(board: BoardRef, raw: RawCard, column: string, me: SourceUser, archived: boolean): Card {
    const assignees: SourceUser[] = [];
    for (const entry of raw.assignedUsers ?? []) {
      const uid = entry.participant?.uid ?? entry.participant?.primaryKey;
      if (!uid) continue;
      assignees.push({ id: uid, displayName: text(entry.participant?.displayname), isMe: uid === me.id });
    }
    const labels: CardLabel[] = [];
    for (const label of raw.labels ?? []) {
      const name = text(label.title);
      if (name) labels.push({ name, color: text(label.color) });
    }
    const cardId = String(raw.id);
    return {
      ref: { source: id, board: board.id, id: cardId },
      title: text(raw.title) ?? cardId,
      sourceColumn: column,
      closed: archived || raw.archived === true || Boolean(raw.done),
      due: due(raw.duedate),
      assignees,
      watchedByMe: null,
      labels,
      url: appUrl(`board/${encodeURIComponent(board.id)}/card/${encodeURIComponent(cardId)}`),
      version: text(raw.ETag),
      updated: fromUnix(raw.lastModified),
    };
  }

  const cardsPath = (boardId: string, stackId: number | string): string =>
    `boards/${encodeURIComponent(boardId)}/stacks/${stackId}/cards`;

  function findCard(stacks: RawStack[], cardId: string): { stack: RawStack; raw: RawCard } | undefined {
    for (const stack of orderedStacks(stacks)) {
      const raw = (stack.cards ?? []).find((c) => String(c.id) === cardId && !(c.deletedAt && c.deletedAt > 0));
      if (raw) return { stack, raw };
    }
    return undefined;
  }

  function stackFor(stacks: RawStack[], column: string): RawStack {
    const ordered = orderedStacks(stacks);
    const names = columnNames(ordered);
    const found = ordered.find((stack) => names.get(stack.id) === column);
    if (!found) throw new InputError(fmt(_('no column "{column}" on this board'), { column }));
    return found;
  }

  const nextOrder = (stack: RawStack): number =>
    (stack.cards ?? []).reduce((max, c) => Math.max(max, (c.order ?? 0) + 1), 0);

  async function readBack(board: BoardRef, cardId: string): Promise<Card> {
    const answer = await stacksOf(board, '');
    const stacks = answer === 'unchanged' ? [] : answer.stacks;
    const hit = findCard(stacks, cardId);
    if (!hit) throw new ResponseFormatError(_('Deck did not return the card after writing it'), { status: 200, url: board.id });
    const names = columnNames(orderedStacks(stacks));
    return toCard(board, hit.raw, names.get(hit.stack.id) ?? hit.stack.title, await whoAmI(), false);
  }

  /**
   * Deck has no conditional write, so the card is read and its ETag compared first (ADR 0013 §5);
   * a card edited between that read and the write is still lost — a window, not a lock.
   * Requests: Deck REST API, https://github.com/nextcloud/deck/blob/main/docs/API.md
   * (create card, update card details, reorder card).
   */
  async function writeCard(write: CardWrite): Promise<Card> {
    if (write.kind === 'create') {
      const board: BoardRef = { source: id, id: write.board, title: '', url: null };
      const answer = await stacksOf(board, '');
      const stacks = answer === 'unchanged' ? [] : answer.stacks;
      const stack = stackFor(stacks, write.column);
      const created = await client.sendJson<RawCard>('POST', cardsPath(board.id, stack.id), {
        title: write.title,
        type: 'plain',
        order: nextOrder(stack),
        duedate: toDeckDue(write.due ?? null),
      });
      if (created.status !== 'ok' || created.data?.id === undefined) {
        throw new ResponseFormatError(_('Deck did not return the new card'), { status: 200, url: board.id });
      }
      return readBack(board, String(created.data.id));
    }

    const board: BoardRef = { source: id, id: write.ref.board, title: '', url: null };
    const answer = await stacksOf(board, '');
    const stacks = answer === 'unchanged' ? [] : answer.stacks;
    const hit = findCard(stacks, write.ref.id);
    if (!hit) throw new InputError(fmt(_('no card {id} on this board'), { id: write.ref.id }));
    if ((hit.raw.ETag ?? null) !== write.version) {
      throw new ConflictError(fmt(_('card {id} changed since it was read'), { id: write.ref.id }), 'deck', 412);
    }
    const base = `${cardsPath(board.id, hit.stack.id)}/${encodeURIComponent(write.ref.id)}`;

    if (write.kind === 'move') {
      const target = stackFor(stacks, write.toColumn);
      await client.sendJson('PUT', `${base}/reorder`, {
        stackId: target.id,
        order: write.position ?? nextOrder(target),
      }, { allowEmpty: true });
    } else {
      const owner = hit.raw.owner;
      await client.sendJson('PUT', base, {
        title: write.changes.title ?? hit.raw.title ?? '',
        description: hit.raw.description ?? '',
        type: hit.raw.type ?? 'plain',
        owner: typeof owner === 'string' ? owner : (owner?.uid ?? owner?.primaryKey ?? (await whoAmI()).id),
        order: hit.raw.order ?? 0,
        duedate: write.changes.due === undefined ? (hit.raw.duedate ?? null) : toDeckDue(write.changes.due),
        archived: hit.raw.archived ?? false,
        done: hit.raw.done ?? null,
      }, { allowEmpty: true });
    }
    return readBack(board, write.ref.id);
  }

  return {
    describe() {
      return { ...info };
    },
    whoAmI,
    writeCard,
    async listBoards() {
      const result = await client.getJson<unknown>('boards');
      if (result.status === 'unchanged') return [];
      if (!Array.isArray(result.data)) {
        throw new ResponseFormatError(_('Deck did not return a list of boards'), { status: 200, url: 'boards' });
      }
      return (result.data as RawBoard[])
        .filter((board) => !board.archived && !(board.deletedAt && board.deletedAt > 0))
        .map((board) => ({
          source: id,
          id: String(board.id),
          title: text(board.title) ?? String(board.id),
          url: boardUrl(String(board.id)),
        }));
    },
    async listColumns(board) {
      const answer = await stacksOf(board, '');
      if (answer === 'unchanged') return [];
      const stacks = orderedStacks(answer.stacks);
      const names = columnNames(stacks);
      return stacks.map((stack, index): SourceColumn => ({
        name: names.get(stack.id) ?? stack.title,
        position: Number.isInteger(stack.order) ? (stack.order as number) : index,
        closed: null,
        initial: null,
      }));
    },
    async listCards(board, query: CardQuery = {}, since = null): Promise<CardPage> {
      const answer = await stacksOf(board, '', since ?? undefined);
      if (answer === 'unchanged') return { kind: 'unchanged' };
      const me = await whoAmI();
      const stacks = orderedStacks(answer.stacks);
      const names = columnNames(stacks);
      const cards: Card[] = [];
      for (const stack of stacks) {
        const column = names.get(stack.id) ?? stack.title;
        for (const raw of [...(stack.cards ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id - b.id)) {
          if (raw.deletedAt && raw.deletedAt > 0) continue;
          cards.push(toCard(board, raw, column, me, false));
        }
      }
      if (query.includeClosed === true) {
        const archived = await stacksOf(board, '/archived');
        if (archived !== 'unchanged') {
          for (const stack of archived.stacks) {
            // A card in a stack the board no longer lists has no column to show in.
            const column = names.get(stack.id);
            if (column === undefined) continue;
            for (const raw of stack.cards ?? []) {
              if (raw.deletedAt && raw.deletedAt > 0) continue;
              cards.push(toCard(board, raw, column, me, true));
            }
          }
        }
      }
      const matched = filterMine(cards, query.mine).filter((card) => query.includeClosed === true || card.closed !== true);
      const limit = query.limit === undefined ? matched.length : Math.max(0, query.limit);
      return {
        kind: 'changed',
        cards: matched.slice(0, limit),
        token: answer.etag ?? null,
        omitted: Math.max(0, matched.length - limit),
      };
    },
  };
}
