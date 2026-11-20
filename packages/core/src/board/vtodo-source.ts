/**
 * Task lists as a board (docs/adr/0007 §1).
 *
 * A `BoardSource` on top of the existing `CalendarBackend`, so EDS and CalDAV reach the board
 * without a second transport and without pressing a Deck card into iCalendar. It is the one
 * adapter that lives in the core: every other source is its own package, this one only reads the
 * port the core already owns.
 *
 * What a plain task list does not have, it reports as `null` rather than inventing:
 *   · no web page — `BoardRef.url` is null, and a card's url is its own `URL` property or nothing,
 *   · no watchers — `hasWatchers: false`, so every `watchedByMe` is null,
 *   · no collection marker through this port — `changeToken: false`; a CalDAV ctag is a delta read
 *     (`CollectionDelta`), which `CalendarBackend` does not expose.
 *
 * The column of a card is its `STATUS`, verbatim and upper-cased, and `rules.ts` maps it.
 */

import type { CalendarBackend } from '@gjsify/pim';
import { ConflictError, InputError } from '../errors.ts';
import { _, fmt } from '../i18n.ts';
import {
  buildReminder,
  findComponent,
  formatUtc,
  parseComponents,
  parseTime,
  readReminder,
  type ContentLine,
} from '../ical.ts';
import { rewriteComponent, type PropertyEdit } from '../rewrite.ts';
import { sourceKey, uidForSourceKey } from '../source-key.ts';
import type { ReminderItem, ReminderStatus } from '../types.ts';
import { updateReminder, type UpdateDeps } from '../update.ts';
import { filterMine } from './mine.ts';
import { classifyColumn } from './rules.ts';
import {
  boardNotFound,
  type BoardRef,
  type BoardSource,
  type Card,
  type CardLabel,
  type CardPage,
  type CardQuery,
  type CardWrite,
  type SourceColumn,
  type SourceInfo,
  type SourceUser,
} from './types.ts';

/** The STATUS values RFC 5545 gives a VTODO, in the order a board reads left to right. */
const COLUMNS: SourceColumn[] = [
  { name: 'BACKLOG', position: 0, closed: false, initial: false },
  { name: 'NEEDS-ACTION', position: 1, closed: false, initial: true },
  { name: 'IN-PROCESS', position: 2, closed: false, initial: false },
  { name: 'COMPLETED', position: 3, closed: true, initial: false },
  { name: 'CANCELLED', position: 4, closed: true, initial: false },
];

/** ADR 0014: backlog is a refinement of NEEDS-ACTION, written as jtx Board's extended status. */
const BACKLOG = 'BACKLOG';
const X_STATUS = 'X-STATUS';
const SORT_ORDER = 'X-APPLE-SORT-ORDER';
/** Superseded by `X-STATUS` (ADR 0014 §1): read as backlog, never written, dropped on a move. */
const LEGACY_COLUMN = 'X-REMINDER-BOARD-COLUMN';
/** Positions are spaced this far apart, so an ordinary drag is one write (ADR 0014 §2). */
const GAP = 1024;

const STATUS_COLUMN: Record<ReminderStatus, string> = {
  'needs-action': 'NEEDS-ACTION',
  'in-process': 'IN-PROCESS',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
  unknown: '',
};

export interface VtodoBoardOptions {
  /** `SourceInfo.id`; the account this backend serves. */
  id?: string;
  /**
   * Who "me" is. A task list has no server identity to ask, so it is configuration: the mail
   * addresses this person answers to, as they appear in `ATTENDEE`/`ORGANIZER` (with or without
   * the `mailto:` prefix, case-insensitive).
   */
  identity?: { id?: string; displayName?: string | null; addresses?: string[] };
  /**
   * Implement `writeCard` (ADR 0013 §2). Off by default: whether a frontend offers writes is its
   * decision, and the grant is checked above this source (`write.ts`), never in it. A list the
   * backend reports as `readOnly` is still refused per board.
   */
  writable?: boolean;
  /** Clock for the stamps a write sets; tests pin it. */
  now?: () => Date;
}

/** A revision marker for a stored task: the same text always gives the same version. */
function versionOf(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ (c + i), 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

function orderOf(line: ContentLine | undefined): number | null {
  const value = line?.value.trim();
  return value !== undefined && /^-?\d+$/.test(value) ? Number(value) : null;
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The order a column is read in: the stored positions, then what a list without any falls back to. */
function inColumn(a: Card, b: Card): number {
  const ao = a.order ?? null;
  const bo = b.order ?? null;
  if (ao !== null && bo !== null) return ao !== bo ? ao - bo : compare(a.ref.id, b.ref.id);
  if (ao !== null) return -1;
  if (bo !== null) return 1;
  if (a.due !== b.due) {
    if (a.due === null) return 1;
    if (b.due === null) return -1;
    return compare(a.due, b.due);
  }
  return compare(a.ref.id, b.ref.id);
}

interface OrderPlan {
  /** The moved or new card's position, or null to leave its line alone. */
  self: number | null;
  /** Neighbours that need a new value, by uid (a renumbering). */
  others: Map<string, number>;
}

/**
 * Where `others` (the destination column without the card, in reading order) leaves room for the
 * card at `index`: the midpoint of its neighbours, or a renumbering of the whole column when the
 * neighbours leave no integer between them. A column nobody has ordered yet stays unordered
 * unless the caller asked for an explicit place.
 */
function planOrder(others: Card[], index: number | undefined): OrderPlan {
  const none: OrderPlan = { self: null, others: new Map() };
  if (index === undefined && !others.some((card) => card.order != null)) return none;
  const at = Math.min(index ?? 0, others.length);
  if (others.every((card) => card.order != null)) {
    const prev = at > 0 ? (others[at - 1].order as number) : null;
    const next = at < others.length ? (others[at].order as number) : null;
    let value: number;
    if (prev === null && next === null) value = GAP;
    else if (prev === null) value = (next as number) - GAP;
    else if (next === null) value = prev + GAP;
    else value = Math.floor((prev + next) / 2);
    const fits = (prev === null || value > prev) && (next === null || value < next);
    if (fits && Number.isSafeInteger(value)) return { self: value, others: new Map() };
  }
  const renumbered = new Map<string, number>();
  others.forEach((card, i) => {
    const value = GAP * (i < at ? i + 1 : i + 2);
    if (card.order !== value) renumbered.set(card.ref.id, value);
  });
  return { self: GAP * (at + 1), others: renumbered };
}

interface LaneEdit {
  status: ReminderStatus;
  properties: PropertyEdit[];
}

/**
 * The lines a lane is made of (ADR 0014 §1). `from` is the column the card leaves: a card leaving
 * the backlog loses its `X-STATUS`, a card leaving done loses its 100 %.
 */
function laneEdit(column: string, from: string | null): LaneEdit {
  const properties: PropertyEdit[] = [];
  const leavesBacklog = from === BACKLOG && column !== BACKLOG;
  if (leavesBacklog) properties.push({ name: X_STATUS, line: null });
  if (from === BACKLOG) properties.push({ name: LEGACY_COLUMN, line: null });
  switch (column) {
    case BACKLOG:
      properties.push({ name: X_STATUS, line: `${X_STATUS}:${BACKLOG}` });
      return { status: 'needs-action', properties };
    case 'NEEDS-ACTION':
      return { status: 'needs-action', properties };
    case 'IN-PROCESS':
      if (from === 'COMPLETED') properties.push({ name: 'PERCENT-COMPLETE', line: null });
      return { status: 'in-process', properties };
    case 'COMPLETED':
      return { status: 'completed', properties };
    default:
      return { status: 'cancelled', properties };
  }
}

function address(value: string): string {
  return value.trim().replace(/^mailto:/i, '').toLowerCase();
}

function textOf(line: { value: string } | undefined): string | null {
  const value = line?.value.trim();
  return value ? value : null;
}

/** `CATEGORIES:a,b` is one line holding several labels; escaped commas stay in the name. */
function labelsOf(value: string | null): CardLabel[] {
  if (!value) return [];
  return value
    .split(/(?<!\\),/)
    .map((name) => name.replace(/\\,/g, ',').trim())
    .filter((name) => name !== '')
    .map((name) => ({ name, color: null }));
}

function instant(line: Parameters<typeof parseTime>[0] | undefined): string | null {
  if (!line) return null;
  try {
    return parseTime(line).iso;
  } catch {
    // An unparseable stamp is not worth refusing a card for; the view just has no "updated".
    return null;
  }
}

export function createVtodoBoardSource(backend: CalendarBackend, options: VtodoBoardOptions = {}): BoardSource {
  const id = options.id ?? backend.id;
  const me: SourceUser = {
    id: options.identity?.id ?? options.identity?.addresses?.[0] ?? 'me',
    displayName: options.identity?.displayName ?? null,
    isMe: true,
  };
  const mine = new Set((options.identity?.addresses ?? []).map(address));

  const info: SourceInfo = { id, type: 'vtodo', canWrite: options.writable === true, hasWatchers: false, changeToken: false };

  const boardOf = (calendar: { uid: string; name: string }): BoardRef => ({
    source: id,
    id: calendar.uid,
    title: calendar.name,
    url: null,
  });

  async function findBoard(board: BoardRef): Promise<BoardRef> {
    const found = (await backend.listCalendars('reminder')).find((calendar) => calendar.uid === board.id);
    if (!found) throw boardNotFound(board.id);
    return boardOf(found);
  }

  /**
   * `ATTENDEE` is who the task was handed to; a list of one's own tasks has none, and then the
   * owner is the person whose list it is. Without a configured identity no address can match, so
   * a shared task carrying attendees is nobody's rather than everybody's.
   */
  function assigneesOf(props: ContentLine[], item: ReminderItem): SourceUser[] {
    const attendees = props.filter((line) => line.name === 'ATTENDEE');
    if (attendees.length === 0) return [me];
    return attendees.map((line) => {
      const value = address(line.value);
      const name = (line.params.CN ?? '').trim() || null;
      if (mine.has(value)) return { ...me, displayName: me.displayName ?? name };
      return { id: value || item.uid, displayName: name, isMe: false };
    });
  }

  /**
   * Backlog is `NEEDS-ACTION` plus an `X-STATUS` the name table of ADR 0008 calls backlog, so a jtx
   * user's own word for it ("Ideen") lands in the lane too. The superseded
   * `X-REMINDER-BOARD-COLUMN:BACKLOG` still reads as backlog.
   */
  function inBacklog(at: (name: string) => ContentLine | undefined): boolean {
    const extended = textOf(at(X_STATUS));
    if (extended !== null && classifyColumn('vtodo', { name: extended }) === 'backlog') return true;
    return textOf(at(LEGACY_COLUMN))?.toUpperCase() === BACKLOG;
  }

  function toCard(board: string, props: ContentLine[], item: ReminderItem, ical: string): Card {
    const at = (name: string) => props.find((line) => line.name === name);
    // An unknown STATUS keeps its own spelling rather than becoming a status it is not; the
    // column list reports it, and the rules answer `unassigned` for it.
    let column = STATUS_COLUMN[item.status] || textOf(at('STATUS'))?.toUpperCase() || 'NEEDS-ACTION';
    if (column === 'NEEDS-ACTION' && inBacklog(at)) column = BACKLOG;
    return {
      ref: { source: id, board, id: item.uid },
      title: item.summary ?? item.uid,
      sourceColumn: column,
      closed: item.status === 'completed' || item.status === 'cancelled',
      due: item.due,
      assignees: assigneesOf(props, item),
      watchedByMe: null,
      labels: labelsOf(textOf(at('CATEGORIES'))),
      url: item.url,
      version: versionOf(ical),
      order: orderOf(at(SORT_ORDER)),
      updated: instant(at('LAST-MODIFIED')) ?? item.created,
    };
  }

  function cardOf(board: string, ical: string): Card | null {
    const item = readReminder(ical, board);
    const comp = findComponent(parseComponents(ical), 'VTODO');
    return item && comp ? toCard(board, comp.props, item, ical) : null;
  }

  async function cardsOf(board: BoardRef): Promise<Card[]> {
    const raw = await backend.listItems({ kind: 'reminder', calendarUid: board.id });
    const cards: Card[] = [];
    for (const entry of raw) {
      const card = cardOf(board.id, entry.ical);
      if (card) cards.push(card);
    }
    return cards;
  }

  async function writableBoard(boardId: string): Promise<BoardRef> {
    const found = (await backend.listCalendars('reminder')).find((calendar) => calendar.uid === boardId);
    if (!found) throw boardNotFound(boardId);
    if (found.readOnly === true) throw new InputError(fmt(_('task list "{uid}" is read-only'), { uid: boardId }));
    return boardOf(found);
  }

  function requireColumn(name: string): void {
    if (!COLUMNS.some((column) => column.name === name)) {
      throw new InputError(fmt(_('a task list has no column "{column}" to write to'), { column: name }));
    }
  }

  /**
   * The board grant was checked above this source (write.ts), so the grant `updateReminder` asks
   * for is the one this write already holds — for exactly this list, nothing wider.
   */
  function updateDeps(board: string): UpdateDeps {
    return {
      backend,
      config: { grants: [{ capability: 'reminder.update', target: board }], routes: [], defaults: {} },
      now: options.now,
    };
  }

  async function cardsInColumn(board: BoardRef, column: string, except: string | null): Promise<Card[]> {
    return (await cardsOf(board))
      .filter((card) => card.sourceColumn === column && card.ref.id !== except)
      .sort(inColumn);
  }

  const orderEdit = (value: number): PropertyEdit => ({ name: SORT_ORDER, line: `${SORT_ORDER}:${value}` });

  async function renumber(board: string, plan: OrderPlan): Promise<void> {
    for (const [uid, value] of plan.others) {
      await updateReminder(updateDeps(board), { calendar: board, uid, properties: [orderEdit(value)] });
    }
  }

  async function stored(board: BoardRef, uid: string, version: string | null): Promise<Card> {
    const item = await backend.getItem(board.id, 'reminder', uid);
    const card = item === null ? null : cardOf(board.id, item.ical);
    if (card === null) throw new InputError(fmt(_('no card {id} on this board'), { id: uid }));
    if (version !== null && version !== card.version) {
      throw new ConflictError(fmt(_('card {id} changed since it was read'), { id: uid }), 'board', 412);
    }
    return card;
  }

  async function write(request: CardWrite): Promise<Card> {
    if (request.kind === 'create') {
      requireColumn(request.column);
      const board = await writableBoard(request.board);
      const lane = laneEdit(request.column, null);
      const now = options.now?.() ?? new Date();
      const uid = uidForSourceKey(sourceKey('board', `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 10)}`));
      const plan = planOrder(await cardsInColumn(board, request.column, null), undefined);
      let ical = buildReminder(
        {
          uid,
          source: sourceKey('board', uid),
          summary: request.title,
          ...(request.due === undefined || request.due === null ? {} : { due: request.due }),
        },
        now,
      );
      const edits: PropertyEdit[] = lane.properties.filter((edit) => edit.line !== null);
      if (lane.status !== 'needs-action') edits.unshift({ name: 'STATUS', line: `STATUS:${request.column}` });
      if (lane.status === 'completed') {
        edits.push({ name: 'PERCENT-COMPLETE', line: 'PERCENT-COMPLETE:100' });
        edits.push({ name: 'COMPLETED', line: `COMPLETED:${formatUtc(now)}` });
      }
      if (plan.self !== null) edits.push(orderEdit(plan.self));
      ical = rewriteComponent(ical, 'VTODO', edits);
      await renumber(board.id, plan);
      const id = (await backend.createItem(board.id, 'reminder', ical)) || uid;
      return await stored(board, id, null);
    }

    const board = await writableBoard(request.ref.board);
    const before = await stored(board, request.ref.id, request.version);

    if (request.kind === 'update') {
      const { title, due } = request.changes;
      await updateReminder(updateDeps(board.id), {
        calendar: board.id,
        uid: request.ref.id,
        ...(title === undefined ? {} : { summary: title }),
        ...(due === undefined ? {} : { due: due === null ? '' : due }),
      });
      return await stored(board, request.ref.id, null);
    }

    requireColumn(request.toColumn);
    const lane = laneEdit(request.toColumn, before.sourceColumn);
    const sameColumn = before.sourceColumn === request.toColumn;
    const plan =
      sameColumn && request.position === undefined
        ? { self: null, others: new Map<string, number>() }
        : planOrder(await cardsInColumn(board, request.toColumn, request.ref.id), request.position);
    await renumber(board.id, plan);
    await updateReminder(updateDeps(board.id), {
      calendar: board.id,
      uid: request.ref.id,
      status: lane.status,
      properties: [...lane.properties, ...(plan.self === null ? [] : [orderEdit(plan.self)])],
    });
    return await stored(board, request.ref.id, null);
  }

  return {
    ...(options.writable === true ? { writeCard: write } : {}),
    describe() {
      return { ...info };
    },
    async whoAmI() {
      return { ...me };
    },
    async listBoards() {
      return (await backend.listCalendars('reminder')).map(boardOf);
    },
    /**
     * The four RFC statuses, plus any other `STATUS` the list actually holds: a card must be
     * findable in the columns its own source reports (the contract), and a server may carry a
     * value this build does not know.
     */
    async listColumns(board) {
      const found = await findBoard(board);
      const known = new Set(COLUMNS.map((column) => column.name));
      const extra = new Set<string>();
      for (const card of await cardsOf(found)) if (!known.has(card.sourceColumn)) extra.add(card.sourceColumn);
      return [
        ...COLUMNS.map((column) => ({ ...column })),
        ...[...extra].map((name, index) => ({
          name,
          position: COLUMNS.length + index,
          closed: null,
          initial: null,
        })),
      ];
    },
    async listCards(board, query: CardQuery = {}): Promise<CardPage> {
      const found = await findBoard(board);
      const all = await cardsOf(found);
      const matched = filterMine(all, query.mine).filter(
        (card) => query.includeClosed === true || card.closed !== true,
      );
      const limit = query.limit === undefined ? matched.length : Math.max(0, query.limit);
      return {
        kind: 'changed',
        cards: matched.slice(0, limit),
        token: null,
        omitted: Math.max(0, matched.length - limit),
      };
    },
  };
}
