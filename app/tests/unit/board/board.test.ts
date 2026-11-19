import { describe, expect, it } from '@gjsify/unit';
import { boardSourceContract } from '@reminder/core';

import { createFakeBoardSource } from './fake-board-source.ts';

export default async () => {
  await describe('BoardSource contract (in-memory fake)', async () => {
    for (const check of boardSourceContract(() => createFakeBoardSource())) {
      await it(check.name, async () => {
        await check.run();
      });
    }
  });

  await describe('BoardSource contract (no watchers, no change token)', async () => {
    const make = () => createFakeBoardSource({ hasWatchers: false, changeToken: false });
    for (const check of boardSourceContract(make)) {
      await it(check.name, async () => {
        await check.run();
      });
    }
  });

  await describe('BoardSource contract failures', async () => {
    await it('catches a source that answers an empty page for an unknown board', async () => {
      const broken = () => {
        const source = createFakeBoardSource();
        return {
          ...source,
          async listColumns() {
            return [];
          },
          async listCards() {
            return { kind: 'changed' as const, cards: [], token: null, omitted: 0 };
          },
        };
      };
      const check = boardSourceContract(broken).find((c) => c.name === 'refuses a board it does not have');
      expect(check !== undefined).toBe(true);
      let message = '';
      try {
        await check?.run();
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message.includes('resolved for a board the source does not have')).toBe(true);
    });

    await it('catches a card in a column listColumns does not report', async () => {
      const broken = () => {
        const source = createFakeBoardSource();
        source.move('c1', 'Review');
        return source;
      };
      const check = boardSourceContract(broken).find((c) => c.name.startsWith('lists cards that match'));
      let message = '';
      try {
        await check?.run();
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message.includes('which listColumns does not report')).toBe(true);
    });
  });

  await describe('fake board source', async () => {
    await it('answers "unchanged" only until a card moves', async () => {
      const source = createFakeBoardSource();
      const board = (await source.listBoards())[0];
      const first = await source.listCards(board, { mine: 'all' });
      expect(first.kind).toBe('changed');
      const token = first.kind === 'changed' ? first.token : null;
      expect((await source.listCards(board, { mine: 'all' }, token)).kind).toBe('unchanged');
      source.move('c4', 'To do');
      expect((await source.listCards(board, { mine: 'all' }, token)).kind).toBe('changed');
    });

    await it('reports watchedByMe as null when the source has no watchers', async () => {
      const source = createFakeBoardSource({ hasWatchers: false });
      const board = (await source.listBoards())[0];
      const page = await source.listCards(board, { mine: 'all', includeClosed: true });
      const cards = page.kind === 'changed' ? page.cards : [];
      expect(cards.length > 0).toBe(true);
      for (const card of cards) expect(card.watchedByMe).toBe(null);
    });
  });
};
