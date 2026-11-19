import { describe, expect, it } from '@gjsify/unit';
import { createMemoryCacheStore, createSyncService, emptyBoardsConfig, type SyncFetch } from '@reminder/core';

import { createBoardModel } from '../../../src/frontends/gui/board-model.ts';
import { bindBoards, boardSyncSources, createBoardSyncFetch } from '../../../src/frontends/gui/board-sync.ts';
import { buildBoardColumns, DEFAULT_BOARD_FILTERS } from '../../../src/frontends/gui/board-view-model.ts';
import { createFakeBoardSource, type FakeBoardSource } from '../board/fake-board-source.ts';

const NOW = new Date(2026, 10, 18, 9, 0);

/**
 * Waits for the service to get there, then for it to be idle again. Both halves matter: a
 * condition that never holds must fail loudly rather than pass with the state it never reached,
 * and the fetch that satisfied it is still unwinding — `running` is cleared a few microtasks after
 * the emit, and a `refresh()` before that is dropped as a duplicate of the call in flight.
 */
async function settle(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (condition()) {
      for (let idle = 0; idle < 20; idle++) await Promise.resolve();
      return;
    }
    await Promise.resolve();
  }
  throw new Error(`the sync service never ${what}`);
}

function entryOf(source: FakeBoardSource) {
  return { source, info: source.describe(), kind: 'deck' as const, host: 'boards.example.org' };
}

async function setup(options: { wrap?: (base: SyncFetch) => SyncFetch } = {}) {
  const source = createFakeBoardSource({ id: 'fake' });
  const bound = await bindBoards([entryOf(source)]);
  const cache = createMemoryCacheStore();
  const boardFetch = createBoardSyncFetch(bound.bindings);
  const service = createSyncService({
    cache,
    fetch: options.wrap ? options.wrap(boardFetch) : boardFetch,
    clock: { now: () => NOW.getTime() },
    scheduler: { setTimeout: () => 0, clearTimeout: () => undefined },
    sources: boardSyncSources(bound.bindings),
  });
  const model = createBoardModel({
    boards: bound.bindings,
    service,
    config: { boards: emptyBoardsConfig() },
    problems: bound.problems,
  });
  return { source, bound, service, model };
}

export default async () => {
  await describe('board bindings', async () => {
    await it('makes one sync source per board, under the board key space', async () => {
      const { bound } = await setup();
      expect(bound.bindings.map((binding) => binding.board.id)).toEqualArray(['b-workshop', 'b-garden']);
      expect(boardSyncSources(bound.bindings).map((s) => `${s.key.account}/${s.key.source}`)).toEqualArray([
        'board:fake/b-workshop',
        'board:fake/b-garden',
      ]);
      expect(boardSyncSources(bound.bindings)[0].host).toBe('boards.example.org');
    });

    await it('asks for everyone`s cards including the closed ones, so a chip needs no fetch', async () => {
      const { source, service, model } = await setup();
      await service.start();
      await settle(() => model.snapshot().loading === false, 'finished its first round');
      const workshop = model.snapshot().boards.find((entry) => entry.board.id === 'b-workshop');
      // c2 belongs to someone else, c3 is done: both arrived anyway.
      expect(workshop?.cards.map((card) => card.ref.id).sort()).toEqualArray(['c1', 'c2', 'c3', 'c4']);
      expect(source.calls.filter((call) => call === 'listCards:b-workshop').length).toBe(1);
    });

    await it('keeps a source that cannot list its boards to itself', async () => {
      const broken = {
        ...createFakeBoardSource({ id: 'broken' }),
        listBoards: async () => {
          throw new Error('no answer');
        },
      };
      const bound = await bindBoards([entryOf(broken as FakeBoardSource)]);
      expect(bound.bindings.length).toBe(0);
      expect(bound.problems.map((problem) => `${problem.source}: ${problem.message}`)).toEqualArray([
        'broken: no answer',
      ]);
    });
  });

  await describe('board model', async () => {
    await it('starts loading and is configured once a board is bound', async () => {
      const { model } = await setup();
      expect(model.snapshot().loading).toBe(true);
      expect(model.snapshot().configured).toBe(true);
    });

    await it('has nothing to load when no source is configured', async () => {
      const model = createBoardModel({ boards: [], service: null, config: { boards: emptyBoardsConfig() } });
      expect(model.snapshot().loading).toBe(false);
      expect(model.snapshot().configured).toBe(false);
    });

    await it('fills the lanes from what the cache holds', async () => {
      const { service, model } = await setup();
      let renders = 0;
      model.subscribe(() => {
        renders += 1;
      });
      await service.start();
      await settle(() => model.snapshot().loading === false, 'finished its first round');
      expect(renders > 0).toBe(true);
      const columns = buildBoardColumns(model.snapshot(), { ...DEFAULT_BOARD_FILTERS, mine: 'all' }, NOW);
      const byLane = new Map(columns.map((column) => [column.id, column.cards.map((card) => card.title)]));
      expect(byLane.get('backlog')).toEqualArray(['Sort the offcuts']);
      expect(byLane.get('in-progress')).toEqualArray(['Rewire the bench lamp']);
      expect(byLane.get('done')).toEqualArray(['Oil the vice']);
      expect(byLane.get('todo')?.sort()).toEqualArray(['Order seed potatoes', 'Sharpen the plane iron']);
    });

    await it('re-renders nothing on a board that answered unchanged', async () => {
      const { source, service, model } = await setup();
      await service.start();
      await settle(() => model.snapshot().loading === false, 'finished its first round');
      const before = source.calls.filter((call) => call.startsWith('listColumns')).length;
      service.refresh();
      await settle(
        () => source.calls.filter((call) => call === 'listCards:b-workshop').length === 2,
        'read the board a second time',
      );
      // The token came back the same, so the columns were not asked for a second time.
      expect(source.calls.filter((call) => call.startsWith('listColumns')).length).toBe(before);
    });

    await it('picks up a card somebody else moved', async () => {
      const { source, service, model } = await setup();
      await service.start();
      await settle(() => model.snapshot().loading === false, 'finished its first round');
      source.move('c1', 'Doing');
      service.refresh();
      await settle(
        () =>
          model
            .snapshot()
            .boards.find((entry) => entry.board.id === 'b-workshop')
            ?.cards.find((card) => card.ref.id === 'c1')?.sourceColumn === 'Doing',
        'saw the moved card',
      );
      const columns = buildBoardColumns(model.snapshot(), { ...DEFAULT_BOARD_FILTERS, mine: 'all' }, NOW);
      expect(columns.find((column) => column.id === 'in-progress')?.cards.length).toBe(2);
    });

    await it('reports a board that failed and keeps drawing the one that did not', async () => {
      const { model, service } = await setup({
        wrap: (base) => async (key, previous) => {
          if (key.source === 'b-garden') throw new Error('not reachable');
          return base(key, previous);
        },
      });
      await service.start();
      await settle(() => model.snapshot().loading === false, 'finished its first round');
      expect(model.snapshot().boards.map((entry) => entry.board.id)).toEqualArray(['b-workshop']);
      expect(model.snapshot().problems.length).toBe(1);
      expect(model.snapshot().problems[0].label).toBe('Garden');
    });
  });
};
