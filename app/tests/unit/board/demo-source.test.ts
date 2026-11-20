import { describe, expect, it } from '@gjsify/unit';
import {
  boardSourceContract,
  boardSourceWriteContract,
  classifyCard,
  classifyColumn,
  createVtodoBoardSource,
  TARGET_COLUMNS,
  type BoardLane,
  type TargetColumn,
} from '@reminder/core';

import {
  createDemoBoardSource,
  createDemoContext,
  DEMO_BOARD_SOURCE_ID,
} from '../../../src/core/demo/index.ts';

const NOW = new Date(2026, 10, 18, 9, 0);

/** Every lane a source's cards land in, including `unassigned` and `ignore`. */
async function lanes(source: ReturnType<typeof createDemoBoardSource>): Promise<Set<TargetColumn>> {
  const type = source.describe().type;
  const board = (await source.listBoards())[0];
  const columns = await source.listColumns(board);
  const page = await source.listCards(board, { mine: 'all', includeClosed: true });
  const found = new Set<TargetColumn>();
  if (page.kind === 'changed') for (const card of page.cards) found.add(classifyCard(type, card, columns));
  return found;
}

export default async () => {
  await describe('demo board source', async () => {
    for (const check of boardSourceContract(() => createDemoBoardSource(NOW))) {
      await it(check.name, async () => {
        await check.run();
      });
    }

    for (const check of boardSourceWriteContract(() => createDemoBoardSource(NOW))) {
      await it(check.name, async () => {
        await check.run();
      });
    }

    await it('writes and knows who watches a card', async () => {
      const info = createDemoBoardSource(NOW).describe();
      expect(info.id).toBe(DEMO_BOARD_SOURCE_ID);
      expect(info.canWrite).toBe(true);
      expect(info.hasWatchers).toBe(true);
      expect(info.changeToken).toBe(true);
    });

    await it('keeps a move to itself: another instance has the fixture again', async () => {
      const source = createDemoBoardSource(NOW);
      const board = (await source.listBoards())[0];
      const page = await source.listCards(board, { mine: 'all', includeClosed: true });
      const card = page.kind === 'changed' ? page.cards[0] : null;
      expect(card).toBeDefined();
      if (!card) return;
      await source.writeCard?.({ kind: 'move', ref: card.ref, version: card.version, toColumn: 'Done' });
      const again = await createDemoBoardSource(NOW).listCards(board, { mine: 'all', includeClosed: true });
      const fresh = again.kind === 'changed' ? again.cards.find((c) => c.ref.id === card.ref.id) : null;
      expect(fresh?.sourceColumn).toBe(card.sourceColumn);
    });

    await it('hands out a new token after a write, so the next read sees the move', async () => {
      const source = createDemoBoardSource(NOW);
      const board = (await source.listBoards())[0];
      const first = await source.listCards(board, { mine: 'all', includeClosed: true });
      const token = first.kind === 'changed' ? first.token : null;
      const card = first.kind === 'changed' ? first.cards[0] : null;
      if (!card) return;
      await source.writeCard?.({ kind: 'move', ref: card.ref, version: card.version, toColumn: 'Done' });
      const after = await source.listCards(board, { mine: 'all', includeClosed: true }, token);
      expect(after.kind).toBe('changed');
    });

    await it('fills all four lanes and leaves one column unassigned', async () => {
      const found = await lanes(createDemoBoardSource(NOW));
      for (const lane of ['backlog', 'todo', 'in-progress', 'done'] as const satisfies readonly BoardLane[])
        expect(found.has(lane)).toBe(true);
      expect(found.has('unassigned')).toBe(true);
      for (const lane of found) expect(TARGET_COLUMNS).toContain(lane);
    });

    await it('names a column no lane claims, so the view has something to show', async () => {
      const source = createDemoBoardSource(NOW);
      const board = (await source.listBoards())[0];
      const columns = await source.listColumns(board);
      const waiting = columns.find((c) => c.name === 'Waiting on client');
      expect(waiting).toBeDefined();
      expect(classifyColumn('deck', { name: waiting?.name ?? '' })).toBe('unassigned');
    });

    await it('has cards of other people, so "mine" leaves something out', async () => {
      const source = createDemoBoardSource(NOW);
      const board = (await source.listBoards())[0];
      const all = await source.listCards(board, { mine: 'all' });
      const assigned = await source.listCards(board, { mine: 'assigned' });
      const count = (page: Awaited<ReturnType<typeof source.listCards>>): number =>
        page.kind === 'changed' ? page.cards.length : -1;
      expect(count(assigned) < count(all)).toBe(true);
      expect(count(assigned) > 0).toBe(true);
    });

    await it('every card carries a page of its own and invented labels', async () => {
      const source = createDemoBoardSource(NOW);
      const board = (await source.listBoards())[0];
      expect(board.url).toMatch(/^https:\/\/boards\.example\.org\//);
      const page = await source.listCards(board, { mine: 'all', includeClosed: true });
      const cards = page.kind === 'changed' ? page.cards : [];
      for (const card of cards) {
        expect(card.url).toMatch(/^https:\/\/boards\.example\.org\//);
        expect(card.ref.source).toBe(DEMO_BOARD_SOURCE_ID);
      }
      expect(cards.some((c) => c.labels.length > 0)).toBe(true);
    });

    await it('answers "unchanged" for the token it just handed out', async () => {
      const source = createDemoBoardSource(NOW);
      const board = (await source.listBoards())[0];
      const first = await source.listCards(board, { mine: 'all' });
      const token = first.kind === 'changed' ? first.token : null;
      expect(token).toBeDefined();
      const again = await source.listCards(board, { mine: 'all' }, token);
      expect(again.kind).toBe('unchanged');
    });
  });

  await describe('demo board sources in the context', async () => {
    await it('serves the column board next to the task lists', async () => {
      const context = createDemoContext(NOW);
      const extra = context.extraBoardSources?.() ?? [];
      expect(extra).toHaveLength(1);
      expect(extra[0].kind).toBe('deck');
      expect(extra[0].host).toBe('boards.example.org');
      expect(extra[0].info.id).toBe(DEMO_BOARD_SOURCE_ID);
    });

    await it('makes "me" the configured person on a task-list board', async () => {
      const context = createDemoContext(NOW);
      const identity = context.boardIdentity?.();
      expect(identity?.id).toBe('alex@example.org');
      const account = context.config().accounts[0];
      const own = context.accountBackend?.(account);
      expect(own).toBeDefined();
      if (!own) return;
      const source = createVtodoBoardSource(own, { id: account.id, identity });
      const me = await source.whoAmI();
      expect(me.isMe).toBe(true);
      expect(me.id).toBe('alex@example.org');
    });

    await it('fills every lane from the task lists too', async () => {
      const context = createDemoContext(NOW);
      const account = context.config().accounts.find((a) => a.id === 'work');
      const own = account ? context.accountBackend?.(account) : undefined;
      expect(own).toBeDefined();
      if (!own || !account) return;
      const source = createVtodoBoardSource(own, { id: account.id, identity: context.boardIdentity?.() });
      const board = (await source.listBoards()).find((b) => b.id === 'tasks');
      expect(board).toBeDefined();
      if (!board) return;
      const columns = await source.listColumns(board);
      const page = await source.listCards(board, { mine: 'all', includeClosed: true });
      const found = new Set<TargetColumn>();
      if (page.kind === 'changed')
        for (const card of page.cards) found.add(classifyCard('vtodo', card, columns));
      for (const lane of ['backlog', 'todo', 'in-progress', 'done'] as const)
        expect(found.has(lane)).toBe(true);
    });
  });
};
