import { describe, expect, it } from '@gjsify/unit';
import { emptyConfig, type BoardCapability, type ReminderConfig } from '@reminder/core';

import { addBoardCard, moveBoardCardByName, updateBoardCard } from '../../../src/core/board-read.ts';
import { staticContext, type Context } from '../../../src/core/context.ts';
import { createFakeBackend } from '../fake-backend.ts';
import { createFakeBoardSource, type FakeBoardSource } from './fake-board-source.ts';

function setup(...capabilities: BoardCapability[]): { context: Context; source: FakeBoardSource } {
  const source = createFakeBoardSource({ writable: true });
  const grants: ReminderConfig['grants'] = capabilities.map((capability) => ({
    capability,
    target: 'fake:b-workshop',
  }));
  const base = staticContext(createFakeBackend([]), { ...emptyConfig(), grants });
  return {
    source,
    context: {
      ...base,
      extraBoardSources: () => [{ source, info: source.describe(), kind: 'deck', host: 'boards.invalid' }],
    },
  };
}

async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    return (err as Error).message;
  }
  return '';
}

const writes = (source: FakeBoardSource) => source.calls.filter((c) => c.startsWith('writeCard')).length;

export default async () => {
  await describe('board writes from the CLI (docs/adr/0013 §8)', async () => {
    await it('moves a card by column name, case-insensitively, with its current version', async () => {
      const { context } = setup('board.move');
      const out = await moveBoardCardByName(context, { board: 'b-workshop', card: 'c1', column: 'doing' });
      expect(out.card.column).toBe('Doing');
      expect(out.card.lane).toBe('in-progress');
      expect(out.board.id).toBe('b-workshop');
    });

    await it('names the columns when the column is unknown, and writes nothing', async () => {
      const { context, source } = setup('board.move');
      const message = await refusal(() =>
        moveBoardCardByName(context, { board: 'b-workshop', card: 'c1', column: 'Shelf' }),
      );
      expect(message).toContain('Backlog, To do, Doing, Done');
      expect(writes(source)).toBe(0);
    });

    await it('refuses an unknown card instead of creating one', async () => {
      const { context, source } = setup('board.move');
      const message = await refusal(() =>
        moveBoardCardByName(context, { board: 'b-workshop', card: 'zz', column: 'Done' }),
      );
      expect(message).toContain('zz');
      expect(writes(source)).toBe(0);
    });

    await it('needs the grant like every other frontend', async () => {
      const { context, source } = setup('board.create');
      const message = await refusal(() =>
        moveBoardCardByName(context, { board: 'b-workshop', card: 'c1', column: 'Done' }),
      );
      expect(message === '').toBe(false);
      expect(writes(source)).toBe(0);
      const garden = setup('board.move');
      expect(
        await refusal(() =>
          moveBoardCardByName(garden.context, { board: 'b-garden', card: 'c5', column: 'Done' }),
        ),
      ).not.toBe('');
    });

    await it('adds a card to a column with a due date', async () => {
      const { context } = setup('board.create');
      const out = await addBoardCard(context, {
        board: 'b-workshop',
        column: 'to do',
        title: 'Glue the drawer',
        due: '2026-12-01',
      });
      expect(out.card.title).toBe('Glue the drawer');
      expect(out.card.column).toBe('To do');
      expect(out.card.due).toBe('2026-12-01');
    });

    await it('refuses an empty title and an unparseable due date', async () => {
      const { context, source } = setup('board.create');
      expect(
        await refusal(() => addBoardCard(context, { board: 'b-workshop', column: 'Doing', title: ' ' })),
      ).not.toBe('');
      expect(
        await refusal(() =>
          addBoardCard(context, { board: 'b-workshop', column: 'Doing', title: 'x', due: 'tomorrow' }),
        ),
      ).toContain('tomorrow');
      expect(writes(source)).toBe(0);
    });

    await it('changes the title, sets and clears the due date', async () => {
      const { context } = setup('board.update');
      const renamed = await updateBoardCard(context, { board: 'b-workshop', card: 'c2', title: 'Rewire it' });
      expect(renamed.card.title).toBe('Rewire it');
      const dated = await updateBoardCard(context, { board: 'b-workshop', card: 'c2', due: '2026-12-24' });
      expect(dated.card.due).toBe('2026-12-24');
      const cleared = await updateBoardCard(context, { board: 'b-workshop', card: 'c2', due: null });
      expect(cleared.card.due).toBeNull();
    });

    await it('refuses a set with nothing to change before reading anything', async () => {
      const { context, source } = setup('board.update');
      expect(await refusal(() => updateBoardCard(context, { board: 'b-workshop', card: 'c2' }))).toContain(
        'nothing to change',
      );
      expect(source.calls.length).toBe(0);
    });
  });
};
