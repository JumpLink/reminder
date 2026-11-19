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
import { findComponent, parseComponents, parseTime, readReminder, type ContentLine } from '../ical.ts';
import type { ReminderItem, ReminderStatus } from '../types.ts';
import { filterMine } from './mine.ts';
import {
  boardNotFound,
  type BoardRef,
  type BoardSource,
  type Card,
  type CardLabel,
  type CardPage,
  type CardQuery,
  type SourceColumn,
  type SourceInfo,
  type SourceUser,
} from './types.ts';

/** The STATUS values RFC 5545 gives a VTODO, in the order a board reads left to right. */
const COLUMNS: SourceColumn[] = [
  { name: 'NEEDS-ACTION', position: 0, closed: false, initial: true },
  { name: 'IN-PROCESS', position: 1, closed: false, initial: false },
  { name: 'COMPLETED', position: 2, closed: true, initial: false },
  { name: 'CANCELLED', position: 3, closed: true, initial: false },
];

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

  const info: SourceInfo = { id, type: 'vtodo', canWrite: false, hasWatchers: false, changeToken: false };

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

  function toCard(board: string, props: ContentLine[], item: ReminderItem): Card {
    const at = (name: string) => props.find((line) => line.name === name);
    // An unknown STATUS keeps its own spelling rather than becoming a status it is not; the
    // column list reports it, and the rules answer `unassigned` for it.
    const column = STATUS_COLUMN[item.status] || textOf(at('STATUS'))?.toUpperCase() || 'NEEDS-ACTION';
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
      version: null,
      updated: instant(at('LAST-MODIFIED')) ?? item.created,
    };
  }

  async function cardsOf(board: BoardRef): Promise<Card[]> {
    const raw = await backend.listItems({ kind: 'reminder', calendarUid: board.id });
    const cards: Card[] = [];
    for (const entry of raw) {
      const item = readReminder(entry.ical, entry.calendarUid);
      const comp = findComponent(parseComponents(entry.ical), 'VTODO');
      if (item && comp) cards.push(toCard(board.id, comp.props, item));
    }
    return cards;
  }

  return {
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
