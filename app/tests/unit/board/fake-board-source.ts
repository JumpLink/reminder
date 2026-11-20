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
  CARD_TIME,
  ConflictError,
  InputError,
  type BoardRef,
  type BoardSource,
  type Card,
  type CardPage,
  type CardQuery,
  type CardWrite,
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
  /** Implement `writeCard`, with per-card versions (default false: a read-only source). */
  writable?: boolean;
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
  /** The card's own version counter, bumped by every write to it. */
  rev: number;
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
    rev: 1,
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
    rev: 1,
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
    rev: 1,
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
    rev: 1,
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
    rev: 1,
  },
];

export function createFakeBoardSource(options: FakeBoardOptions = {}): FakeBoardSource {
  const id = options.id ?? 'fake';
  const hasWatchers = options.hasWatchers ?? true;
  const changeToken = options.changeToken ?? true;
  const writable = options.writable ?? false;
  const calls: string[] = [];
  const seeds = SEEDS.map((seed) => ({ ...seed, assignees: [...seed.assignees] }));
  let revision = 1;
  let serial = 0;

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
    version: `v${seed.rev}`,
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
      seed.rev += 1;
      revision += 1;
    },
    describe() {
      return { id, type: 'deck', canWrite: writable, hasWatchers, changeToken };
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
    ...(writable
      ? {
          async writeCard(write: CardWrite): Promise<Card> {
            calls.push(`writeCard:${write.kind}`);
            const boardId = write.kind === 'create' ? write.board : write.ref.board;
            if (!boards.some((b) => b.id === boardId)) throw boardNotFound(boardId);
            const known = (column: string) => COLUMNS.some((c) => c.name === column);
            if (write.kind === 'create') {
              if (!known(write.column)) throw new InputError(`no column ${write.column}`);
              if (write.due !== undefined && write.due !== null && !CARD_TIME.test(write.due))
                throw new InputError(`bad due ${write.due}`);
              serial += 1;
              const seed: Seed = {
                id: `n${serial}`,
                board: write.board,
                title: write.title,
                column: write.column,
                closed: write.column === 'Done',
                due: write.due ?? null,
                assignees: [ME],
                watched: false,
                rev: 1,
              };
              seeds.push(seed);
              revision += 1;
              return toCard(seed);
            }
            const seed = seeds.find((s) => s.id === write.ref.id && s.board === write.ref.board);
            if (!seed) throw new InputError(`no card ${write.ref.id}`);
            if (write.version !== `v${seed.rev}`) throw new ConflictError(`card ${seed.id} changed`);
            if (write.kind === 'move') {
              if (!known(write.toColumn)) throw new InputError(`no column ${write.toColumn}`);
              seed.column = write.toColumn;
              seed.closed = write.toColumn === 'Done';
            } else {
              if (write.changes.title !== undefined) seed.title = write.changes.title;
              if (write.changes.due !== undefined) seed.due = write.changes.due;
            }
            seed.rev += 1;
            revision += 1;
            return toCard(seed);
          },
        }
      : {}),
  };
}
