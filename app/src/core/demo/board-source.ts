/**
 * The demo's second board: a source that is not a task list, so `--demo` shows what the view is
 * for — columns the server names itself ("Waiting on client" belongs to no lane and stays
 * visible as its own), people other than the reader, labels, and a page on the web behind every
 * card.
 *
 * Invented from end to end: the hosts are `example.org` names, which exist for exactly this, and
 * the arrays below are the whole "server". Nothing here opens a connection, and `canWrite` is
 * false, so the demo cannot pretend to save anything.
 *
 * It is no adapter for any product. `type: 'deck'` says only "a column board that knows who
 * watches a card", which is what the view needs to tell a non-VTODO source apart; the real
 * adapters are their own packages.
 */

import {
  boardNotFound,
  filterMine,
  type BoardRef,
  type BoardSource,
  type Card,
  type CardPage,
  type CardQuery,
  type SourceColumn,
  type SourceInfo,
  type SourceUser,
} from '@reminder/core';

import { DEMO_IDENTITY, DEMO_PEOPLE } from './fixtures.ts';

export const DEMO_BOARD_SOURCE_ID = 'relaunch-board';
const BOARD_ID = 'relaunch';

/** The data never changes, so one token is enough: every later read answers `unchanged`. */
const TOKEN = 'demo-1';

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
  canWrite: false,
  hasWatchers: true,
  changeToken: true,
};

const BOARD: BoardRef = {
  source: DEMO_BOARD_SOURCE_ID,
  id: BOARD_ID,
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

function toCard(entry: DemoCard, now: Date): Card {
  return {
    ref: { source: DEMO_BOARD_SOURCE_ID, board: BOARD_ID, id: entry.id },
    title: entry.title,
    sourceColumn: entry.column,
    closed: entry.closed === true,
    due: entry.due === undefined ? null : dayString(now, entry.due),
    assignees: entry.assignees.map((user) => ({ ...user })),
    watchedByMe: entry.watchedByMe,
    labels: (entry.labels ?? []).map((name) => ({ name, color: null })),
    url: `https://boards.example.org/b/${BOARD_ID}/card/${entry.id}`,
    version: TOKEN,
    // One of the three time shapes of `types.ts` — a UTC instant without a fraction, which is
    // what the contract test accepts.
    updated: new Date(now.getTime() - entry.updatedAgo * 24 * 60 * 60 * 1000)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z'),
  };
}

export function createDemoBoardSource(now: Date = new Date()): BoardSource {
  return {
    describe: () => ({ ...INFO }),
    whoAmI: async () => ({ ...me }),
    listBoards: async () => [{ ...BOARD }],
    async listColumns(board) {
      if (board.id !== BOARD_ID) throw boardNotFound(board.id);
      return COLUMNS.map((column) => ({ ...column }));
    },
    async listCards(board, query: CardQuery = {}, since = null): Promise<CardPage> {
      if (board.id !== BOARD_ID) throw boardNotFound(board.id);
      if (since === TOKEN) return { kind: 'unchanged' };
      const matched = filterMine(
        CARDS.map((entry) => toCard(entry, now)),
        query.mine,
      ).filter((card) => query.includeClosed === true || card.closed !== true);
      const limit = query.limit === undefined ? matched.length : Math.max(0, query.limit);
      return {
        kind: 'changed',
        cards: matched.slice(0, limit),
        token: TOKEN,
        omitted: Math.max(0, matched.length - limit),
      };
    },
  };
}
