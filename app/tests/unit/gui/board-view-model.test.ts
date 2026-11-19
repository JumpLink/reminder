import { describe, expect, it } from '@gjsify/unit';
import type { Card, SourceColumn, SourceUser } from '@reminder/core';

import {
  activeBoardChips,
  avatarsOf,
  boardCardDetail,
  boardDueDate,
  boardSourceOptions,
  boardStatus,
  buildBoardColumns,
  cardKey,
  DEFAULT_BOARD_FILTERS,
  describeBoardProblems,
  DONE_WINDOW_DAYS,
  emptyBoardSnapshot,
  findBoardCard,
  initialsOf,
  laneOf,
  showsSource,
  withoutBoardChip,
  type BoardFilters,
  type BoardSnapshot,
  type LoadedBoard,
} from '../../../src/frontends/gui/board-view-model.ts';

const NOW = new Date(2026, 10, 18, 9, 0);

const ME: SourceUser = { id: 'alex@example.org', displayName: 'Alex Sommer', isMe: true };
const INES: SourceUser = { id: 'ines@example.org', displayName: 'Ines Vogt', isMe: false };

const COLUMNS: SourceColumn[] = [
  { name: 'Backlog', position: 0, closed: false, initial: false },
  { name: 'To do', position: 1, closed: false, initial: true },
  { name: 'Doing', position: 2, closed: false, initial: false },
  { name: 'Waiting on client', position: 3, closed: false, initial: false },
  { name: 'Done', position: 4, closed: true, initial: false },
];

function card(id: string, column: string, extra: Partial<Card> = {}): Card {
  return {
    ref: { source: 'studio', board: 'relaunch', id },
    title: id,
    sourceColumn: column,
    closed: column === 'Done',
    due: null,
    assignees: [ME],
    watchedByMe: false,
    labels: [],
    url: `https://boards.example.org/b/relaunch/card/${id}`,
    version: 'v1',
    updated: '2026-11-17T08:00:00Z',
    ...extra,
  };
}

function board(cards: readonly Card[], extra: Partial<LoadedBoard> = {}): LoadedBoard {
  return {
    source: 'studio',
    type: 'deck',
    board: {
      source: 'studio',
      id: 'relaunch',
      title: 'Relaunch',
      url: 'https://boards.example.org/b/relaunch',
    },
    columns: COLUMNS,
    cards,
    overrides: {},
    writable: false,
    ...extra,
  };
}

function snapshot(boards: readonly LoadedBoard[], extra: Partial<BoardSnapshot> = {}): BoardSnapshot {
  return { boards, problems: [], loading: false, configured: true, ...extra };
}

const titles = (snap: BoardSnapshot, filters: BoardFilters = { ...DEFAULT_BOARD_FILTERS, mine: 'all' }) =>
  buildBoardColumns(snap, filters, NOW).map(
    (column) => `${column.id}:${column.cards.map((c) => c.title).join('|')}`,
  );

export default async () => {
  await describe('board lanes', async () => {
    await it('draws the four lanes even when a lane is empty', async () => {
      const columns = buildBoardColumns(snapshot([board([card('a', 'To do')])]), undefined, NOW);
      expect(columns.map((column) => column.id).join(',')).toBe('backlog,todo,in-progress,done');
    });

    await it('puts each card in the lane the core rules name', async () => {
      const cards = [card('a', 'Backlog'), card('b', 'To do'), card('c', 'Doing'), card('d', 'Done')];
      expect(titles(snapshot([board(cards)]))).toEqualArray([
        'backlog:a',
        'todo:b',
        'in-progress:c',
        'done:d',
      ]);
    });

    await it('gives a column no rule claims its own lane, and only when it has cards', async () => {
      const waiting = snapshot([board([card('a', 'To do'), card('w', 'Waiting on client')])]);
      expect(titles(waiting)).toContain('unassigned:w');
      expect(
        titles(snapshot([board([card('a', 'To do')])])).some((line) => line.startsWith('unassigned')),
      ).toBe(false);
    });

    await it('does not draw a card the rules ignore', async () => {
      const cancelled = board([card('x', 'Cancelled', { closed: false })], { type: 'vtodo' });
      expect(laneOf(cancelled.cards[0], cancelled)).toBeNull();
      expect(titles(snapshot([cancelled])).join(',')).toBe('backlog:,todo:,in-progress:,done:');
    });

    await it('sorts a lane by due date, then by title', async () => {
      const cards = [
        card('late', 'To do', { due: '2026-12-01' }),
        card('soon', 'To do', { due: '2026-11-20' }),
        card('zz', 'To do'),
        card('aa', 'To do'),
      ];
      expect(titles(snapshot([board(cards)]))[1]).toBe('todo:soon|late|aa|zz');
    });
  });

  await describe('board filters', async () => {
    await it('shows every source while none is selected', async () => {
      expect(showsSource(DEFAULT_BOARD_FILTERS, 'studio')).toBe(true);
      expect(showsSource({ ...DEFAULT_BOARD_FILTERS, sources: ['other'] }, 'studio')).toBe(false);
    });

    await it('leaves the cards of a source that is not selected out', async () => {
      const second = board([card('s', 'To do', { ref: { source: 'home', board: 'chores', id: 's' } })], {
        source: 'home',
        board: { source: 'home', id: 'chores', title: 'Chores', url: null },
      });
      const both = snapshot([board([card('a', 'To do')]), second]);
      expect(titles(both)[1]).toBe('todo:a|s');
      expect(titles(both, { ...DEFAULT_BOARD_FILTERS, mine: 'all', sources: ['home'] })[1]).toBe('todo:s');
    });

    await it('defaults to the cards assigned to me', async () => {
      expect(DEFAULT_BOARD_FILTERS.mine).toBe('assigned');
      const cards = [card('mine', 'To do'), card('theirs', 'To do', { assignees: [INES] })];
      expect(buildBoardColumns(snapshot([board(cards)]), DEFAULT_BOARD_FILTERS, NOW)[1].cards.length).toBe(1);
    });

    await it('adds the cards I watch for "watching", and everything for "all"', async () => {
      const cards = [
        card('mine', 'To do'),
        card('watched', 'To do', { assignees: [INES], watchedByMe: true }),
        card('theirs', 'To do', { assignees: [INES] }),
      ];
      const snap = snapshot([board(cards)]);
      const lane = (mine: BoardFilters['mine']) =>
        buildBoardColumns(snap, { ...DEFAULT_BOARD_FILTERS, mine }, NOW)[1].cards.map((c) => c.title);
      expect(lane('assigned')).toEqualArray(['mine']);
      expect(lane('watching').sort()).toEqualArray(['mine', 'watched']);
      expect(lane('all').length).toBe(3);
    });

    await it('drops the done lane entirely when done is switched off', async () => {
      const snap = snapshot([board([card('a', 'To do'), card('d', 'Done')])]);
      const off: BoardFilters = { ...DEFAULT_BOARD_FILTERS, mine: 'all', includeDone: false };
      expect(buildBoardColumns(snap, off, NOW).map((column) => column.id)).toEqualArray([
        'backlog',
        'todo',
        'in-progress',
      ]);
    });

    await it('keeps a done card inside the window and hides an older one', async () => {
      const day = 24 * 60 * 60 * 1000;
      const fresh = new Date(NOW.getTime() - (DONE_WINDOW_DAYS - 1) * day).toISOString();
      const old = new Date(NOW.getTime() - (DONE_WINDOW_DAYS + 1) * day).toISOString();
      const cards = [
        card('fresh', 'Done', { updated: fresh }),
        card('old', 'Done', { updated: old }),
        // No timestamp is no reason to hide a card.
        card('undated', 'Done', { updated: null }),
      ];
      expect(titles(snapshot([board(cards)]))[3]).toBe('done:fresh|undated');
    });
  });

  await describe('board chips', async () => {
    await it('names every narrowing in force, the default "mine" included', async () => {
      const snap = snapshot([board([card('a', 'To do')])]);
      const chips = activeBoardChips(snap, {
        ...DEFAULT_BOARD_FILTERS,
        sources: ['studio'],
        includeDone: false,
      });
      expect(chips.map((chip) => chip.key.kind)).toEqualArray(['source', 'mine', 'done']);
      expect(chips[0].label).toBe('Relaunch');
      expect(activeBoardChips(snap, { sources: [], mine: 'all', includeDone: true }).length).toBe(0);
    });

    await it('widens a filter when its chip goes', async () => {
      const filters: BoardFilters = { sources: ['studio', 'home'], mine: 'assigned', includeDone: false };
      expect(withoutBoardChip(filters, { kind: 'source', id: 'studio' }).sources).toEqualArray(['home']);
      expect(withoutBoardChip(filters, { kind: 'mine' }).mine).toBe('all');
      expect(withoutBoardChip(filters, { kind: 'done' }).includeDone).toBe(true);
    });

    await it('offers every source the popover can filter by, failed ones included', async () => {
      const snap = snapshot([board([card('a', 'To do')])], {
        problems: [{ source: 'home', label: 'Chores', message: 'not reachable' }],
      });
      expect(boardSourceOptions(snap).map((option) => `${option.id}=${option.name}`)).toEqualArray([
        'studio=Relaunch',
        'home=Chores',
      ]);
    });
  });

  await describe('board status', async () => {
    await it('is loading until the first source has answered', async () => {
      expect(boardStatus(emptyBoardSnapshot(), [])).toStrictEqual({ kind: 'loading' });
    });

    await it('is unconfigured when there is no source at all', async () => {
      expect(boardStatus({ ...emptyBoardSnapshot(), loading: false }, [])).toStrictEqual({
        kind: 'unconfigured',
      });
    });

    await it('is failed only when every source failed', async () => {
      const dead = snapshot([], {
        problems: [{ source: 'home', label: 'Chores', message: 'not reachable' }],
      });
      const status = boardStatus(dead, []);
      expect(status.kind).toBe('failed');
      expect(status.kind === 'failed' ? status.message : '').toContain('Chores: not reachable');
    });

    await it('is empty when sources answered but no card passes the filters', async () => {
      const snap = snapshot([board([card('theirs', 'To do', { assignees: [INES] })])]);
      expect(boardStatus(snap, buildBoardColumns(snap, DEFAULT_BOARD_FILTERS, NOW))).toStrictEqual({
        kind: 'empty',
      });
    });

    await it('draws the cards it has while one source is missing', async () => {
      const snap = snapshot([board([card('a', 'To do')])], {
        problems: [{ source: 'home', label: 'Chores', message: 'not reachable' }],
      });
      expect(boardStatus(snap, buildBoardColumns(snap, DEFAULT_BOARD_FILTERS, NOW))).toStrictEqual({
        kind: 'cards',
      });
      expect(describeBoardProblems(snap.problems)).toContain('Chores: not reachable');
      expect(describeBoardProblems([])).toBeNull();
    });
  });

  await describe('board cards', async () => {
    await it('reads initials from the display name, and falls back to the id', async () => {
      expect(initialsOf(ME)).toBe('AS');
      expect(initialsOf({ id: 'jonas@example.org', displayName: null, isMe: false })).toBe('JE');
      expect(initialsOf({ id: '', displayName: null, isMe: false })).toBe('?');
    });

    await it('puts my own avatar first', async () => {
      expect(avatarsOf({ assignees: [INES, ME] })).toEqualArray(['AS', 'IV']);
    });

    await it('reads a bare due date as that day here, not as UTC midnight', async () => {
      const due = boardDueDate('2026-12-01');
      expect(due?.getFullYear()).toBe(2026);
      expect(due?.getMonth()).toBe(11);
      expect(due?.getDate()).toBe(1);
      expect(boardDueDate(null)).toBeNull();
      expect(boardDueDate('not a date')).toBeNull();
    });

    await it('finds a card by the key the widget carries, and nothing by a stale one', async () => {
      const snap = snapshot([
        board([card('a', 'Doing', { due: '2026-12-01', labels: [{ name: 'web', color: null }] })]),
      ]);
      const key = cardKey({ source: 'studio', board: 'relaunch', id: 'a' });
      const found = findBoardCard(snap, key);
      expect(found?.card.ref.id).toBe('a');
      expect(findBoardCard(snap, cardKey({ source: 'studio', board: 'relaunch', id: 'gone' }))).toBeNull();

      const detail = boardCardDetail(found?.card as Card, snap.boards[0]);
      expect(detail.lane).toBe('in-progress');
      expect(detail.sourceColumn).toBe('Doing');
      expect(detail.sourceLabel).toBe('Relaunch');
      expect(detail.assignees).toEqualArray(['Alex Sommer']);
      expect(detail.labels).toEqualArray(['web']);
      expect(detail.url).toBe('https://boards.example.org/b/relaunch/card/a');
    });

    await it('locks a card only where another board could be written', async () => {
      const readOnly = snapshot([board([card('a', 'To do')])]);
      expect(buildBoardColumns(readOnly, DEFAULT_BOARD_FILTERS, NOW)[1].cards[0].readOnly).toBe(false);

      const mixed = snapshot([
        board([card('a', 'To do')]),
        board([card('b', 'To do', { ref: { source: 'home', board: 'chores', id: 'b' } })], {
          source: 'home',
          board: { source: 'home', id: 'chores', title: 'Chores', url: null },
          writable: true,
        }),
      ]);
      const lane = buildBoardColumns(mixed, { ...DEFAULT_BOARD_FILTERS, mine: 'all' }, NOW)[1];
      expect(lane.cards.map((entry) => entry.readOnly)).toEqualArray([true, false]);
    });

    await it('titles a card the source left empty', async () => {
      const snap = snapshot([board([card('a', 'To do', { title: '' })])]);
      expect(buildBoardColumns(snap, DEFAULT_BOARD_FILTERS, NOW)[1].cards[0].title === '').toBe(false);
    });
  });
};
