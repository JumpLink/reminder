/**
 * An in-memory BoardSource. It speaks the port exactly — the same normalisation an adapter owes,
 * no column rules, no view filter — so `boardSourceContract` is exercised against something before
 * the first real adapter exists.
 *
 * Invented data only: no real host, no real person. `capabilities` makes the same fixture answer
 * as a source with watchers and change detection (Deck, OpenProject) or without (a plain list), so
 * both branches of the contract run.
 */

import {
  boardNotFound,
  type BoardRef,
  type BoardSource,
  type Card,
  type CardPage,
  type CardQuery,
  type SourceColumn,
  type SourceUser,
} from '@reminder/core';

export interface FakeBoardSource extends BoardSource {
  /** Every call, in order: `listCards:<board>` and friends. */
  calls: string[];
  /** Move a card to another column, as a second person would. Bumps the change token. */
  move(cardId: string, column: string): void;
}

export interface FakeBoardOptions {
  id?: string;
  hasWatchers?: boolean;
  changeToken?: boolean;
}

const ME: SourceUser = { id: 'u-me', displayName: 'Me', isMe: true };
const OTHER: SourceUser = { id: 'u-other', displayName: 'Someone Else', isMe: false };

const COLUMNS: SourceColumn[] = [
  { name: 'Backlog', position: 0, closed: false, initial: false },
  { name: 'To do', position: 1, closed: false, initial: true },
  { name: 'Doing', position: 2, closed: false, initial: false },
  { name: 'Done', position: 3, closed: true, initial: false },
];

interface Seed {
  id: string;
  board: string;
  title: string;
  column: string;
  closed: boolean;
  due: string | null;
  assignees: SourceUser[];
  watched: boolean;
}

const SEEDS: Seed[] = [
  {
    id: 'c1',
    board: 'b-workshop',
    title: 'Sharpen the plane iron',
    column: 'To do',
    closed: false,
    due: '2026-12-01',
    assignees: [ME],
    watched: true,
  },
  {
    id: 'c2',
    board: 'b-workshop',
    title: 'Rewire the bench lamp',
    column: 'Doing',
    closed: false,
    due: '2026-12-04T17:00:00Z',
    assignees: [OTHER],
    watched: true,
  },
  {
    id: 'c3',
    board: 'b-workshop',
    title: 'Oil the vice',
    column: 'Done',
    closed: true,
    due: null,
    assignees: [ME],
    watched: false,
  },
  {
    id: 'c4',
    board: 'b-workshop',
    title: 'Sort the offcuts',
    column: 'Backlog',
    closed: false,
    due: null,
    assignees: [],
    watched: false,
  },
  {
    id: 'c5',
    board: 'b-garden',
    title: 'Order seed potatoes',
    column: 'To do',
    closed: false,
    due: '2027-01-15',
    assignees: [ME],
    watched: false,
  },
];

export function createFakeBoardSource(options: FakeBoardOptions = {}): FakeBoardSource {
  const id = options.id ?? 'fake';
  const hasWatchers = options.hasWatchers ?? true;
  const changeToken = options.changeToken ?? true;
  const calls: string[] = [];
  const seeds = SEEDS.map((seed) => ({ ...seed, assignees: [...seed.assignees] }));
  let revision = 1;

  const boards: BoardRef[] = [
    { source: id, id: 'b-workshop', title: 'Workshop', url: 'https://boards.invalid/b/b-workshop' },
    { source: id, id: 'b-garden', title: 'Garden', url: 'https://boards.invalid/b/b-garden' },
  ];

  const find = (board: BoardRef) => boards.find((b) => b.id === board.id) ?? null;

  const toCard = (seed: Seed): Card => ({
    ref: { source: id, board: seed.board, id: seed.id },
    title: seed.title,
    sourceColumn: seed.column,
    closed: seed.closed,
    due: seed.due,
    assignees: seed.assignees,
    watchedByMe: hasWatchers ? seed.watched : null,
    labels: seed.closed ? [] : [{ name: 'shop', color: '#4a7023' }],
    url: `https://boards.invalid/b/${seed.board}/card/${seed.id}`,
    version: `r${revision}`,
    updated: '2026-11-18T08:00:00Z',
  });

  const mineOf = (seed: Seed, mine: string): boolean => {
    if (mine === 'all') return true;
    const assigned = seed.assignees.some((user) => user.isMe);
    if (mine === 'assigned') return assigned;
    return assigned || (hasWatchers && seed.watched);
  };

  return {
    calls,
    move(cardId, column) {
      const seed = seeds.find((s) => s.id === cardId);
      if (!seed) throw new Error(`no card ${cardId}`);
      seed.column = column;
      seed.closed = column === 'Done';
      revision += 1;
    },
    describe() {
      return { id, type: 'deck', canWrite: false, hasWatchers, changeToken };
    },
    async whoAmI() {
      calls.push('whoAmI');
      return ME;
    },
    async listBoards() {
      calls.push('listBoards');
      return boards.map((board) => ({ ...board }));
    },
    async listColumns(board) {
      calls.push(`listColumns:${board.id}`);
      if (!find(board)) throw boardNotFound(board.id);
      return COLUMNS.map((column) => ({ ...column }));
    },
    async listCards(board, query: CardQuery = {}, since): Promise<CardPage> {
      calls.push(`listCards:${board.id}`);
      if (!find(board)) throw boardNotFound(board.id);
      const token = changeToken ? `r${revision}` : null;
      if (changeToken && since !== undefined && since !== null && since === token)
        return { kind: 'unchanged' };
      const mine = query.mine ?? 'assigned';
      const matched = seeds.filter(
        (seed) =>
          seed.board === board.id && mineOf(seed, mine) && (query.includeClosed === true || !seed.closed),
      );
      const limit = query.limit === undefined ? matched.length : Math.max(0, query.limit);
      return {
        kind: 'changed',
        cards: matched.slice(0, limit).map(toCard),
        token,
        omitted: Math.max(0, matched.length - limit),
      };
    },
  };
}
