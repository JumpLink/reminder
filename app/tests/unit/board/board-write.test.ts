import { describe, expect, it } from '@gjsify/unit';
import {
  boardSourceWriteContract,
  ConflictError,
  createCard,
  findSourceColumn,
  GrantDeniedError,
  InputError,
  moveCard,
  parseGrants,
  resolveLaneColumn,
  updateCard,
  type BoardSource,
  type BoardWriteContext,
  type Card,
} from '@reminder/core';

import { createFakeBoardSource, type FakeBoardSource } from './fake-board-source.ts';

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

const TARGET = 'fake:b-workshop';

function setup(grants: unknown, options: { writable?: boolean } = {}) {
  const source: FakeBoardSource = createFakeBoardSource({ writable: options.writable ?? true });
  const context: BoardWriteContext = {
    grants: parseGrants(grants),
    source: (id) => (id === 'fake' ? source : undefined),
  };
  return { source, context };
}

async function firstCard(source: BoardSource): Promise<Card> {
  const board = (await source.listBoards())[0];
  const page = await source.listCards(board, { mine: 'all' });
  if (page.kind !== 'changed') throw new Error('expected cards');
  return page.cards[0];
}

export default async () => {
  await describe('BoardSource write contract (in-memory fake)', async () => {
    for (const check of boardSourceWriteContract(() => createFakeBoardSource({ writable: true }))) {
      await it(check.name, async () => {
        await check.run();
      });
    }
  });

  await describe('BoardSource write contract failures', async () => {
    await it('catches a source that overwrites on a stale version', async () => {
      const blind = () => {
        const source = createFakeBoardSource({ writable: true });
        const write = source.writeCard!.bind(source);
        return {
          ...source,
          async writeCard(request: Parameters<typeof write>[0]) {
            if (request.kind === 'create') return write(request);
            const fresh = await firstCard(source);
            return write({ ...request, version: fresh.version });
          },
        };
      };
      const check = boardSourceWriteContract(blind).find((c) => c.name.startsWith('refuses a stale version'));
      expect(check !== undefined).toBe(true);
      expect((await failure(check!.run())) !== null).toBe(true);
    });

    await it('catches a source that claims to write without writeCard', async () => {
      const liar = () => {
        const { writeCard: _w, ...rest } = createFakeBoardSource({ writable: true });
        return { ...rest } as BoardSource;
      };
      const check = boardSourceWriteContract(liar)[0];
      expect((await failure(check.run())) !== null).toBe(true);
    });
  });

  await describe('board writes need a grant on the exact board', async () => {
    await it('refuses every write without a grant, and never calls the source', async () => {
      const { source, context } = setup([]);
      const card = await firstCard(source);
      source.calls.length = 0;
      const errors = [
        await failure(moveCard(context, { ref: card.ref, version: card.version, toColumn: 'Doing' })),
        await failure(updateCard(context, { ref: card.ref, version: card.version, changes: { title: 'x' } })),
        await failure(
          createCard(context, { source: 'fake', board: 'b-workshop', column: 'Doing', title: 'x' }),
        ),
      ];
      for (const err of errors) expect(err instanceof GrantDeniedError).toBe(true);
      expect(source.calls.filter((c) => c.startsWith('writeCard')).length).toBe(0);
      expect(source.calls.length).toBe(0);
    });

    await it('refuses a grant for another board, another source or another capability', async () => {
      const { source, context } = setup([
        { capability: 'board.move', target: 'fake:b-garden' },
        { capability: 'board.move', target: 'other:b-workshop' },
        { capability: 'board.update', target: TARGET },
      ]);
      const card = await firstCard(source);
      source.calls.length = 0;
      const err = await failure(
        moveCard(context, { ref: card.ref, version: card.version, toColumn: 'Doing' }),
      );
      expect(err instanceof GrantDeniedError).toBe(true);
      expect(source.calls.length).toBe(0);
    });

    await it('moves with board.move only, and board.move does not allow an update', async () => {
      const { source, context } = setup([{ capability: 'board.move', target: TARGET }]);
      const card = await firstCard(source);
      const moved = await moveCard(context, { ref: card.ref, version: card.version, toColumn: 'Doing' });
      expect(moved.sourceColumn).toBe('Doing');
      const err = await failure(
        updateCard(context, { ref: card.ref, version: moved.version, changes: { title: 'y' } }),
      );
      expect(err instanceof GrantDeniedError).toBe(true);
    });

    await it('updates and creates with their own grants', async () => {
      const { source, context } = setup([
        { capability: 'board.update', target: TARGET },
        { capability: 'board.create', target: TARGET },
      ]);
      const card = await firstCard(source);
      const updated = await updateCard(context, {
        ref: card.ref,
        version: card.version,
        changes: { due: null },
      });
      expect(updated.due).toBe(null);
      const created = await createCard(context, {
        source: 'fake',
        board: 'b-workshop',
        column: 'To do',
        title: 'Fresh',
      });
      expect(created.title).toBe('Fresh');
    });

    await it('raises ConflictError for a stale version and writes nothing', async () => {
      const { source, context } = setup([{ capability: 'board.move', target: TARGET }]);
      const card = await firstCard(source);
      source.move(card.ref.id, 'Backlog');
      const err = await failure(
        moveCard(context, { ref: card.ref, version: card.version, toColumn: 'Doing' }),
      );
      expect(err instanceof ConflictError).toBe(true);
      expect((await firstCard(source)).sourceColumn).toBe('Backlog');
    });

    await it('refuses a read-only source after the grant, and rejects bad input before the source', async () => {
      const { source, context } = setup([{ capability: 'board.move', target: TARGET }], { writable: false });
      const card = await firstCard(source);
      source.calls.length = 0;
      expect(
        (await failure(
          moveCard(context, { ref: card.ref, version: card.version, toColumn: 'Doing' }),
        )) instanceof InputError,
      ).toBe(true);
      const writable = setup([{ capability: 'board.move', target: TARGET }]);
      const blank = await failure(
        moveCard(writable.context, { ref: card.ref, version: card.version, toColumn: ' ' }),
      );
      expect(blank instanceof InputError).toBe(true);
      expect(writable.source.calls.some((c) => c.startsWith('writeCard'))).toBe(false);
    });
  });

  await describe('lanes and column names resolve to source columns', async () => {
    const columns = [
      { name: 'Backlog', position: 0, closed: false, initial: false },
      { name: 'To do', position: 1, closed: false, initial: true },
      { name: 'Doing', position: 2, closed: false, initial: false },
      { name: 'Done', position: 3, closed: true, initial: false },
      { name: 'Shipped', position: 4, closed: true, initial: false },
    ];

    await it('answers a lane with one column, several, or none', async () => {
      const one = resolveLaneColumn('deck', columns, 'in-progress');
      expect(one.kind).toBe('column');
      const many = resolveLaneColumn('deck', columns, 'done');
      expect(many.kind).toBe('ambiguous');
      expect(many.kind === 'ambiguous' ? many.candidates.length : 0).toBe(2);
      expect(resolveLaneColumn('deck', columns.slice(0, 2), 'done').kind).toBe('none');
    });

    await it('matches a typed column name case-insensitively', async () => {
      expect(findSourceColumn(columns, 'doing').length).toBe(1);
      expect(findSourceColumn(columns, 'DOING')[0].name).toBe('Doing');
      expect(findSourceColumn(columns, 'nope').length).toBe(0);
    });
  });
};
