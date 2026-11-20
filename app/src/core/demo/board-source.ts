/**
 * The demo's second board: a source that is not a task list, so `--demo` shows what the view is
 * for — columns the server names itself ("Waiting on client" belongs to no lane and stays
 * visible as its own), people other than the reader, labels, and a page on the web behind every
 * card.
 *
 * Invented from end to end: the hosts are `example.org` names, which exist for exactly this, and
 * the arrays below are the whole "server". Nothing here opens a connection.
 *
 * It writes, so `--demo` can show the move the board is for (ADR 0013): `writeCard` edits the
 * array this instance built at construction and bumps the change token, which is why the window
 * says "nothing is saved" — the move lives exactly as long as the process.
 *
 * It is no adapter for any product. `type: 'deck'` says only "a column board that knows who
 * watches a card", which is what the view needs to tell a non-VTODO source apart; the real
 * adapters are their own packages.
 */

import {
  boardNotFound,
  ConflictError,
  filterMine,
  fmt,
  InputError,
  _,
  type BoardRef,
  type BoardSource,
  type Card,
  type CardPage,
  type CardQuery,
  type CardWrite,
  type SourceColumn,
  type SourceInfo,
  type SourceUser,
} from '@reminder/core';

import { DEMO_IDENTITY, DEMO_PEOPLE } from './fixtures.ts';

export const DEMO_BOARD_SOURCE_ID = 'relaunch-board';
export const DEMO_BOARD_ID = 'relaunch';

/**
 * The collection marker. Nothing but a write changes the data, so it counts writes: a reader that
 * saw the board before a move gets the cards again, a reader that saw it after gets `unchanged`.
 */
const tokenOf = (revision: number): string => `demo-${revision}`;

const me: SourceUser = {
  id: DEMO_IDENTITY.addresses[0],
  displayName: DEMO_IDENTITY.displayName,
  isMe: true,
};
const ines: SourceUser = { id: DEMO_PEOPLE.ines.address, displayName: DEMO_PEOPLE.ines.name, isMe: false };
const jonas: SourceUser = { id: DEMO_PEOPLE.jonas.address, displayName: DEMO_PEOPLE.jonas.name, isMe: false };

const INFO: SourceInfo = {
  id: DEMO_BOARD_SOURCE_ID,
  type: 'deck',
  canWrite: true,
  hasWatchers: true,
  changeToken: true,
};

const BOARD: BoardRef = {
  source: DEMO_BOARD_SOURCE_ID,
  id: DEMO_BOARD_ID,
  title: 'Website relaunch',
  url: 'https://boards.example.org/b/relaunch',
};

/** "Waiting on client" matches no lane name and is no closed column: the view draws it unsorted. */
const COLUMNS: readonly SourceColumn[] = [
  { name: 'Ideas', position: 0, closed: false, initial: false },
  { name: 'To do', position: 1, closed: false, initial: true },
  { name: 'In progress', position: 2, closed: false, initial: false },
  { name: 'Waiting on client', position: 3, closed: false, initial: false },
  { name: 'Done', position: 4, closed: true, initial: false },
];

interface DemoCard {
  id: string;
  title: string;
  column: string;
  assignees: SourceUser[];
  watchedByMe: boolean;
  labels?: readonly string[];
  /** Whole days from today, or absent for a card with no date. */
  due?: number;
  closed?: boolean;
  /** Last changed this many days ago. */
  updatedAgo: number;
}

const CARDS: readonly DemoCard[] = [
  {
    id: '101',
    title: 'Collect the old sitemap',
    column: 'Ideas',
    assignees: [me],
    watchedByMe: true,
    labels: ['content'],
    updatedAgo: 6,
  },
  {
    id: '102',
    title: 'Decide on the typeface',
    column: 'Ideas',
    assignees: [me, ines],
    watchedByMe: true,
    labels: ['design'],
    due: 9,
    updatedAgo: 4,
  },
  {
    id: '103',
    title: 'Write the start page copy',
    column: 'To do',
    assignees: [me],
    watchedByMe: true,
    labels: ['content', 'copy'],
    due: 2,
    updatedAgo: 1,
  },
  {
    id: '104',
    title: 'Set up the staging server',
    column: 'To do',
    assignees: [ines],
    watchedByMe: true,
    labels: ['infra'],
    due: 5,
    updatedAgo: 2,
  },
  {
    id: '105',
    title: 'Print the flyers for the launch party',
    column: 'To do',
    assignees: [jonas],
    watchedByMe: false,
    labels: ['print'],
    due: 7,
    updatedAgo: 3,
  },
  {
    id: '106',
    title: 'Rebuild the photo gallery',
    column: 'In progress',
    assignees: [me, jonas],
    watchedByMe: true,
    labels: ['frontend'],
    due: -1,
    updatedAgo: 0,
  },
  {
    id: '107',
    title: 'Clarify the photo licences',
    column: 'Waiting on client',
    assignees: [me],
    watchedByMe: true,
    labels: ['legal'],
    due: 1,
    updatedAgo: 5,
  },
  {
    id: '108',
    title: 'Move the old blog posts',
    column: 'Done',
    assignees: [me],
    watchedByMe: true,
    closed: true,
    updatedAgo: 2,
  },
  // Finished more than two weeks ago: the done lane's window leaves it out (plan §6.6).
  {
    id: '109',
    title: 'Agree on the launch date',
    column: 'Done',
    assignees: [me, ines],
    watchedByMe: true,
    closed: true,
    updatedAgo: 30,
  },
];

const pad = (n: number): string => String(n).padStart(2, '0');

function dayString(now: Date, offset: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A UTC instant without a fraction — one of the three time shapes `types.ts` accepts. */
const stamp = (at: Date): string => at.toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * The fixture with every relative date resolved and every field mutable: one of these per
 * instance, so a move in one window is invisible to the next `createDemoBoardSource`. `rev` counts
 * the writes to THIS card and is what its version is spelled from, which is how a second write
 * with the first version becomes a `ConflictError`.
 */
interface LiveCard {
  id: string;
  title: string;
  column: string;
  assignees: SourceUser[];
  watchedByMe: boolean;
  labels: string[];
  due: string | null;
  closed: boolean;
  updated: string;
  rev: number;
}

function liveOf(entry: DemoCard, now: Date): LiveCard {
  return {
    id: entry.id,
    title: entry.title,
    column: entry.column,
    assignees: entry.assignees.map((user) => ({ ...user })),
    watchedByMe: entry.watchedByMe,
    labels: [...(entry.labels ?? [])],
    due: entry.due === undefined ? null : dayString(now, entry.due),
    closed: entry.closed === true,
    updated: stamp(new Date(now.getTime() - entry.updatedAgo * 24 * 60 * 60 * 1000)),
    rev: 0,
  };
}

function toCard(card: LiveCard): Card {
  return {
    ref: { source: DEMO_BOARD_SOURCE_ID, board: DEMO_BOARD_ID, id: card.id },
    title: card.title,
    sourceColumn: card.column,
    closed: card.closed,
    due: card.due,
    assignees: card.assignees.map((user) => ({ ...user })),
    watchedByMe: card.watchedByMe,
    labels: card.labels.map((name) => ({ name, color: null })),
    url: `https://boards.example.org/b/${DEMO_BOARD_ID}/card/${card.id}`,
    version: `demo-${card.id}-${card.rev}`,
    updated: card.updated,
  };
}

export function createDemoBoardSource(now: Date = new Date()): BoardSource {
  const cards: LiveCard[] = CARDS.map((entry) => liveOf(entry, now));
  let revision = 1;
  let nextId = 1 + cards.reduce((max, card) => Math.max(max, Number(card.id) || 0), 100);

  const columnOf = (name: string): SourceColumn => {
    const found = COLUMNS.find((column) => column.name === name);
    if (!found) throw new InputError(fmt(_('this board has no column "{column}"'), { column: name }));
    return found;
  };

  function board(id: string): void {
    if (id !== DEMO_BOARD_ID) throw boardNotFound(id);
  }

  function cardAt(id: string, version: string | null): LiveCard {
    const found = cards.find((card) => card.id === id);
    if (!found) throw new InputError(fmt(_('no card {id} on this board'), { id }));
    if (version !== null && version !== toCard(found).version) {
      throw new ConflictError(fmt(_('card {id} changed since it was read'), { id }), 'board', 412);
    }
    return found;
  }

  /**
   * The order a column is read in is the order of this array, so a position is an insert: the card
   * leaves where it was and goes in before the one that currently holds that index.
   */
  function place(card: LiveCard, column: string, position: number | undefined): void {
    const rest = cards.filter((other) => other !== card);
    const inColumn = rest.filter((other) => other.column === column);
    const index = position === undefined ? inColumn.length : Math.max(0, Math.min(position, inColumn.length));
    const anchor = inColumn[index];
    const last = inColumn[inColumn.length - 1];
    const at =
      anchor !== undefined
        ? rest.indexOf(anchor)
        : last === undefined
          ? rest.length
          : rest.indexOf(last) + 1;
    rest.splice(at, 0, card);
    cards.length = 0;
    cards.push(...rest);
  }

  function touched(card: LiveCard): Card {
    card.rev += 1;
    card.updated = stamp(now);
    revision += 1;
    return toCard(card);
  }

  async function writeCard(request: CardWrite): Promise<Card> {
    if (request.kind === 'create') {
      board(request.board);
      const column = columnOf(request.column);
      const card: LiveCard = {
        id: String(nextId++),
        title: request.title,
        column: column.name,
        assignees: [{ ...me }],
        watchedByMe: true,
        labels: [],
        due: request.due === undefined || request.due === null ? null : request.due,
        closed: column.closed === true,
        updated: stamp(now),
        rev: 0,
      };
      place(card, column.name, undefined);
      return touched(card);
    }

    board(request.ref.board);
    if (request.kind === 'update') {
      const card = cardAt(request.ref.id, request.version);
      const { title, due } = request.changes;
      if (title !== undefined) card.title = title;
      if (due !== undefined) card.due = due;
      return touched(card);
    }

    const column = columnOf(request.toColumn);
    const card = cardAt(request.ref.id, request.version);
    card.column = column.name;
    card.closed = column.closed === true;
    place(card, column.name, request.position);
    return touched(card);
  }

  return {
    writeCard,
    describe: () => ({ ...INFO }),
    whoAmI: async () => ({ ...me }),
    listBoards: async () => [{ ...BOARD }],
    async listColumns(ref) {
      board(ref.id);
      return COLUMNS.map((column) => ({ ...column }));
    },
    async listCards(ref, query: CardQuery = {}, since = null): Promise<CardPage> {
      board(ref.id);
      if (since === tokenOf(revision)) return { kind: 'unchanged' };
      const matched = filterMine(cards.map(toCard), query.mine).filter(
        (card) => query.includeClosed === true || card.closed !== true,
      );
      const limit = query.limit === undefined ? matched.length : Math.max(0, query.limit);
      return {
        kind: 'changed',
        cards: matched.slice(0, limit),
        token: tokenOf(revision),
        omitted: Math.max(0, matched.length - limit),
      };
    },
  };
}
