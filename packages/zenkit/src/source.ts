/**
 * Zenkit as a read-only `BoardSource` (docs/adr/0007).
 *
 * Mapping: a Zenkit list is a board; the values of one choice (categories) field are its columns;
 * a persons field says whose card it is; a second choice field gives labels and a date field the
 * due date. Which fields those are is a per-list option because Zenkit lists have no fixed
 * layout. The default is the first field of the fitting kind.
 *
 * Zenkit has no watchers (`hasWatchers: false`) and no notion of "finished" for a choice value
 * (`closed: null`), so `rules.ts` decides the lane by name. There are no ETags: change detection
 * is one probe request, see `probe`.
 *
 * The adapter normalises and decides nothing else — no lane, no view filter beyond `CardQuery`.
 */

import { HttpClient, ResponseFormatError, type HostLimiter } from '@gjsify/http-client';
import {
  _,
  boardNotFound,
  filterMine,
  fmt,
  InputError,
  type BoardRef,
  type BoardSource,
  type Card,
  type CardLabel,
  type CardPage,
  type CardQuery,
  type ChangeToken,
  type SourceColumn,
  type SourceUser,
} from '@reminder/core';

/** Zenkit's `elementcategory` numbers (the kind of a field). */
const DATE = 4;
const CATEGORIES = 6;
const PERSONS = 14;

/** Entries per request, and the most pages read for one list: 2 000 entries. */
const PAGE_SIZE = 50;
const MAX_PAGES = 40;

export const ZENKIT_API_URL = 'https://zenkit.com/api/v1/';
export const ZENKIT_WEB_URL = 'https://base.zenkit.com/';

/** Which fields of one list play which role. A selector is a field's uuid, id, shortId or name. */
export interface ZenkitListFields {
  /** The choice field whose values are the columns. Default: the first one. */
  columnField?: string;
  /** The persons field that says who a card is assigned to. Default: the first one. */
  personField?: string;
  /** The choice field read as labels. Default: the first one that is not the column field; `false`: none. */
  labelField?: string | false;
  /** The date field read as due date. Default: the first one; `false`: none. */
  dueField?: string | false;
}

export interface ZenkitOptions {
  /** `SourceInfo.id`: the configured account this source serves. */
  id: string;
  /** The personal API key; sent as `Zenkit-API-Key`, never put into an error. */
  apiKey: string;
  /** Default `ZENKIT_API_URL`; a self-hosted instance overrides it. */
  baseUrl?: string;
  /** Where links to the web app point. Default `ZENKIT_WEB_URL`. */
  webUrl?: string;
  /** Per list, keyed by the list's shortId, id or uuid. */
  lists?: Record<string, ZenkitListFields>;
  /** Only these lists are boards (shortId, id or uuid). Default: every list the key can open. */
  onlyLists?: string[];
  /** Transport overrides, mainly for tests. */
  http?: { fetch?: typeof fetch; limiter?: HostLimiter; timeoutMs?: number };
}

type Json = Record<string, unknown>;

interface Choice {
  id: string;
  name: string;
  color: string | null;
  order: number;
}

interface Field {
  id: string;
  uuid: string;
  shortId: string;
  name: string;
  category: number;
  order: number;
  choices: Choice[];
}

interface ListInfo {
  id: string;
  shortId: string | null;
  uuid: string | null;
  name: string;
}

interface Layout {
  column: Field;
  persons: Field | null;
  labels: Field | null;
  due: Field | null;
}

const NO_VALUE = (): string => _('No value');

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : typeof value === 'number' ? String(value) : null;

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** `2026-12-01T17:00:00.000Z` to `2026-12-01T17:00:00Z`, the shape `types.ts` knows; null when unreadable. */
function instant(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function toField(raw: Json): Field | null {
  const category = typeof raw.elementcategory === 'number' ? raw.elementcategory : 0;
  const uuid = asString(raw.uuid);
  if (!uuid || raw.deprecated_at) return null;
  const data = (raw.elementData ?? {}) as Json;
  const choices = asArray(data.predefinedCategories)
    .map((entry, index): Choice | null => {
      const choice = entry as Json;
      const id = asString(choice.id);
      const name = asString(choice.name);
      if (!id || !name || choice.deprecated_at) return null;
      const order = Number(choice.sortOrder);
      return {
        id,
        name,
        color: asString(choice.colorHex),
        order: Number.isFinite(order) ? order : index,
      };
    })
    .filter((choice): choice is Choice => choice !== null)
    .sort((a, b) => a.order - b.order);
  const order = Number(raw.sortOrder);
  return {
    id: asString(raw.id) ?? uuid,
    uuid,
    shortId: asString(raw.shortId) ?? '',
    name: asString(raw.name) ?? '',
    category,
    order: Number.isFinite(order) ? order : 0,
    choices,
  };
}

function selectField(
  fields: Field[],
  selector: string | false | undefined,
  category: number,
  taken: string[],
  list: string,
): Field | null {
  if (selector === false) return null;
  if (selector !== undefined) {
    const wanted = selector.toLowerCase();
    const found = fields.find(
      (field) =>
        field.uuid === selector ||
        field.id === selector ||
        field.shortId === selector ||
        field.name.toLowerCase() === wanted,
    );
    if (!found) throw new InputError(fmt(_('no field {field} in list {id}'), { field: selector, id: list }));
    if (found.category !== category) {
      throw new InputError(fmt(_('field {field} in list {id} has the wrong type for this use'), { field: selector, id: list }));
    }
    return found;
  }
  return fields.find((field) => field.category === category && !taken.includes(field.uuid)) ?? null;
}

export function createZenkitBoardSource(options: ZenkitOptions): BoardSource {
  const client = new HttpClient({
    baseUrl: options.baseUrl ?? ZENKIT_API_URL,
    auth: { type: 'header', name: 'Zenkit-API-Key', value: options.apiKey },
    fetch: options.http?.fetch,
    limiter: options.http?.limiter,
    timeoutMs: options.http?.timeoutMs,
  });
  const webUrl = (options.webUrl ?? ZENKIT_WEB_URL).replace(/\/*$/, '/');
  const id = options.id;
  let me: SourceUser | null = null;
  let lists: ListInfo[] | null = null;

  async function get<T>(path: string): Promise<T> {
    const result = await client.getJson<T>(path);
    if (result.status !== 'ok') throw new ResponseFormatError('unexpected "unchanged" answer', { url: client.origin });
    return result.data;
  }

  async function whoAmI(): Promise<SourceUser> {
    if (me) return me;
    const user = await get<Json>('users/me');
    const userId = asString(user.id);
    if (!userId) throw new ResponseFormatError('users/me has no id', { url: client.origin });
    me = { id: userId, displayName: asString(user.displayname) ?? asString(user.username), isMe: true };
    return me;
  }

  const idsOf = (list: ListInfo): string[] =>
    [list.id, list.shortId, list.uuid].filter((value): value is string => value !== null);

  const allowed = (list: ListInfo): boolean =>
    options.onlyLists === undefined || options.onlyLists.some((entry) => idsOf(list).includes(entry));

  async function loadLists(): Promise<ListInfo[]> {
    const workspaces = await get<Json[]>('users/me/workspacesWithLists');
    const found: ListInfo[] = [];
    for (const workspace of asArray(workspaces) as Json[]) {
      for (const raw of asArray(workspace.lists) as Json[]) {
        const listId = asString(raw.shortId) ?? asString(raw.id);
        if (!listId) continue;
        found.push({
          id: listId,
          shortId: asString(raw.shortId),
          uuid: asString(raw.uuid),
          name: asString(raw.name) ?? listId,
        });
      }
    }
    lists = found.filter(allowed);
    return lists;
  }

  async function findList(board: BoardRef): Promise<ListInfo> {
    const match = (all: ListInfo[]) => all.find((list) => list.id === board.id);
    const found = match(lists ?? (await loadLists())) ?? match(await loadLists());
    if (!found) throw boardNotFound(board.id);
    return found;
  }

  const fieldsFor = (list: ListInfo): ZenkitListFields => {
    for (const key of idsOf(list)) {
      const configured = options.lists?.[key];
      if (configured) return configured;
    }
    return {};
  };

  async function layoutOf(list: ListInfo): Promise<Layout> {
    const raw = await get<Json[]>(`lists/${list.id}/elements`);
    const fields = asArray(raw)
      .map((entry) => toField(entry as Json))
      .filter((field): field is Field => field !== null)
      .sort((a, b) => a.order - b.order);
    const wanted = fieldsFor(list);
    const column = selectField(fields, wanted.columnField, CATEGORIES, [], list.id);
    if (!column) throw new InputError(fmt(_('list {id} has no choice field to use as its columns'), { id: list.id }));
    return {
      column,
      persons: selectField(fields, wanted.personField, PERSONS, [], list.id),
      labels: selectField(fields, wanted.labelField, CATEGORIES, [column.uuid], list.id),
      due: selectField(fields, wanted.dueField, DATE, [], list.id),
    };
  }

  /**
   * Change detection (no ETags in Zenkit): one `limit: 1` request for the entry updated last, plus
   * the list's total. The token holds the query, that entry's `updated_at` and the total, so an
   * edit moves the first and an archive or delete moves the second. It assumes the server honours
   * the sort; if it does not, the probe returns an arbitrary entry and the answer is "changed" —
   * the safe direction.
   */
  async function probe(list: ListInfo): Promise<{ updated: string; total: number } | null> {
    const page = await client.postJson<Json>(`lists/${list.id}/entries/filter`, {
      filter: {},
      limit: 1,
      skip: 0,
      sortBy: 'updated_at',
      sortDirection: 'desc',
    });
    if (page.status !== 'ok') return null;
    const total = Number((page.data.countData as Json | undefined)?.filteredTotal);
    const first = entriesOf(page.data)[0];
    if (!Number.isFinite(total)) return null;
    return { updated: instant(first?.updated_at) ?? '', total };
  }

  const entriesOf = (body: unknown): Json[] => {
    if (Array.isArray(body)) return body as Json[];
    const listed = (body as Json | null)?.listEntries ?? (body as Json | null)?.entries;
    return asArray(listed) as Json[];
  };

  async function fetchAll(list: ListInfo): Promise<Json[]> {
    const entries: Json[] = [];
    for (let page = 0; ; page += 1) {
      if (page >= MAX_PAGES) {
        throw new ResponseFormatError(`more than ${MAX_PAGES * PAGE_SIZE} entries in a list`, { url: client.origin });
      }
      const result = await client.postJson<Json>(`lists/${list.id}/entries/filter`, {
        filter: {},
        limit: PAGE_SIZE,
        skip: page * PAGE_SIZE,
      });
      if (result.status !== 'ok') break;
      const batch = entriesOf(result.data);
      entries.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return entries;
  }

  function toCard(list: ListInfo, layout: Layout, entry: Json, user: SourceUser): Card | null {
    const entryId = asString(entry.shortId) ?? asString(entry.id);
    if (!entryId || entry.deprecated_at) return null;
    const title = asString(entry.displayString) ?? entryId;

    const column = (() => {
      const first = asArray(entry[`${layout.column.uuid}_categories`])[0];
      const choice = layout.column.choices.find((value) => value.id === String(first));
      return choice?.name ?? NO_VALUE();
    })();

    const labels: CardLabel[] = layout.labels
      ? asArray(entry[`${layout.labels.uuid}_categories`])
          .map((value) => layout.labels!.choices.find((choice) => choice.id === String(value)))
          .filter((choice): choice is Choice => choice !== undefined)
          .map((choice) => ({ name: choice.name, color: choice.color }))
      : [];

    const assignees: SourceUser[] = layout.persons
      ? (() => {
          const named = new Map<string, string | null>();
          for (const person of asArray(entry[`${layout.persons!.uuid}_persons_sort`]) as Json[]) {
            const personId = asString(person.id);
            if (personId) named.set(personId, asString(person.displayname));
          }
          return asArray(entry[`${layout.persons!.uuid}_persons`]).map((value) => {
            const personId = String(value);
            return { id: personId, displayName: named.get(personId) ?? null, isMe: personId === user.id };
          });
        })()
      : [];

    let due: string | null = null;
    if (layout.due) {
      const raw = entry[`${layout.due.uuid}_date`];
      if (entry[`${layout.due.uuid}_hasTime`] === true) due = instant(raw);
      else if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw)) due = raw.slice(0, 10);
    }

    const updated = instant(entry.updated_at);
    const base = list.shortId && asString(entry.shortId) ? `${webUrl}l/${list.shortId}/${entry.shortId}` : null;
    return {
      ref: { source: id, board: list.id, id: entryId },
      title,
      sourceColumn: column,
      closed: null,
      due,
      assignees,
      watchedByMe: null,
      labels,
      url: base,
      version: updated,
      updated,
    };
  }

  return {
    describe() {
      return { id, type: 'zenkit', canWrite: false, hasWatchers: false, changeToken: true };
    },

    whoAmI,

    async listBoards() {
      const all = await loadLists();
      return all.map(
        (list): BoardRef => ({
          source: id,
          id: list.id,
          title: list.name,
          url: list.shortId ? `${webUrl}l/${list.shortId}` : null,
        }),
      );
    },

    async listColumns(board): Promise<SourceColumn[]> {
      const layout = await layoutOf(await findList(board));
      const columns = layout.column.choices.map(
        (choice, position): SourceColumn => ({ name: choice.name, position, closed: null, initial: null }),
      );
      const seen = new Set<string>();
      const unique = columns.filter((column) => !seen.has(column.name) && seen.add(column.name) !== undefined);
      // Entries with no value in the field still need a column to stand in; rules.ts places it as "unassigned".
      if (!seen.has(NO_VALUE())) unique.push({ name: NO_VALUE(), position: null, closed: null, initial: null });
      return unique;
    },

    async listCards(board, query: CardQuery = {}, since?: ChangeToken | null): Promise<CardPage> {
      const list = await findList(board);
      const mine = query.mine ?? 'assigned';
      const key = `${mine}|${query.includeClosed === true ? 1 : 0}|${query.limit ?? ''}`;
      const tokenFor = (state: { updated: string; total: number }): string =>
        `${key}@${state.updated}#${state.total}`;

      if (since) {
        const state = await probe(list);
        if (state && tokenFor(state) === since) return { kind: 'unchanged' };
      }

      const layout = await layoutOf(list);
      const user = await whoAmI();
      const entries = await fetchAll(list);
      const updatedMax = entries.map((entry) => instant(entry.updated_at) ?? '').sort().pop() ?? '';
      const cards = entries
        .map((entry) => toCard(list, layout, entry, user))
        .filter((card): card is Card => card !== null);
      const matched = filterMine(cards, mine).filter((card) => query.includeClosed === true || card.closed !== true);
      const limit = query.limit === undefined ? matched.length : Math.max(0, query.limit);
      return {
        kind: 'changed',
        cards: matched.slice(0, limit),
        token: tokenFor({ updated: updatedMax, total: entries.length }),
        omitted: Math.max(0, matched.length - limit),
      };
    },
  };
}
