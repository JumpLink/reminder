import { describe, expect, it } from '@gjsify/unit';
import { emptyConfig, type ReminderConfig } from '@reminder/core';

import { listBoardCards, listBoards } from '../../../src/core/board-read.ts';
import { staticContext } from '../../../src/core/context.ts';
import { createDemoContext, DEMO_BOARD_SOURCE_ID } from '../../../src/core/demo/index.ts';
import { boardLine, cardLine } from '../../../src/frontends/cli/board.ts';
import { calendar, createFakeBackend, vtodo } from '../fake-backend.ts';

const NOW = new Date(2026, 10, 18, 9, 0);

export default async () => {
  await describe('board read (CLI and MCP share it)', async () => {
    await it('lists the demo boards with the column board among them', async () => {
      const result = await listBoards(createDemoContext(NOW));
      const board = result.boards.find((b) => b.source === DEMO_BOARD_SOURCE_ID);
      expect(board?.id).toBe('relaunch');
      expect(board?.title).toBe('Website relaunch');
      expect(result.omitted).toBe(0);
    });

    await it('reports the boards beyond the limit', async () => {
      const all = await listBoards(createDemoContext(NOW));
      const one = await listBoards(createDemoContext(NOW), { limit: 1 });
      expect(one.boards.length).toBe(1);
      expect(one.omitted).toBe(all.boards.length - 1);
    });

    await it('puts cards in lanes, hides done ones and ignores the window', async () => {
      const open = await listBoardCards(createDemoContext(NOW), { board: 'relaunch', mine: 'all' });
      const titles = open.cards.map((c) => c.title);
      expect(titles.includes('Move the old blog posts')).toBe(false);
      const waiting = open.cards.find((c) => c.title === 'Clarify the photo licences');
      expect(waiting?.lane).toBe('unassigned');
      expect(waiting?.column).toBe('Waiting on client');
      const withDone = await listBoardCards(createDemoContext(NOW), {
        board: 'relaunch',
        mine: 'all',
        includeDone: true,
      });
      expect(withDone.cards.some((c) => c.lane === 'done')).toBe(true);
      expect(withDone.cards.length > open.cards.length).toBe(true);
    });

    await it('answers only the own cards by default', async () => {
      const mine = await listBoardCards(createDemoContext(NOW), { board: 'relaunch' });
      const all = await listBoardCards(createDemoContext(NOW), { board: 'relaunch', mine: 'all' });
      expect(mine.cards.length < all.cards.length).toBe(true);
      expect(mine.cards.some((c) => c.title === 'Print the flyers for the launch party')).toBe(false);
    });

    await it('caps the cards and counts what it cut', async () => {
      const full = await listBoardCards(createDemoContext(NOW), { board: 'relaunch', mine: 'all' });
      const capped = await listBoardCards(createDemoContext(NOW), {
        board: 'relaunch',
        mine: 'all',
        limit: 2,
      });
      expect(capped.cards.length).toBe(2);
      expect(capped.omitted).toBe(full.cards.length - 2);
    });

    await it('sorts by lane, then due date with undated last', async () => {
      const { cards } = await listBoardCards(createDemoContext(NOW), { board: 'relaunch', mine: 'all' });
      const order = ['backlog', 'todo', 'in-progress', 'done', 'unassigned'];
      const lanes = cards.map((c) => order.indexOf(c.lane));
      expect(lanes.join(',')).toBe([...lanes].sort((a, b) => a - b).join(','));
    });

    await it('refuses an unknown board instead of answering empty', async () => {
      let message = '';
      try {
        await listBoardCards(createDemoContext(NOW), { board: 'nope' });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain('nope');
    });

    await it('fails whole when one account is broken (docs/adr/0005)', async () => {
      // A CalDAV account without its section cannot build a backend; the other account is fine.
      const config: ReminderConfig = {
        ...emptyConfig(),
        accounts: [
          { id: 'broken', backend: 'caldav', extra: {} },
          { id: 'fine', backend: 'eds', extra: {} },
        ],
      };
      let message = '';
      try {
        await listBoards(staticContext(createFakeBackend([], {}), config));
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain('broken');
    });

    await it('serves a hidden-but-enabled list and never a disabled one', async () => {
      const backend = createFakeBackend(
        [calendar('shown', 'reminder', 'Shown'), calendar('off', 'reminder', 'Off')],
        {
          shown: [vtodo('a', ['SUMMARY:Reply'])],
          off: [vtodo('b', ['SUMMARY:Secret'])],
        },
      );
      // "Hidden" is the window's filter: no configuration can carry it, so both lists are served.
      const open = await listBoards(staticContext(backend, emptyConfig()));
      expect(
        open.boards
          .map((b) => b.id)
          .sort()
          .join(','),
      ).toBe('off,shown');
      const off = await listBoards(staticContext(backend, { ...emptyConfig(), disabled: ['off'] }));
      expect(off.boards.map((b) => b.id).join(',')).toBe('shown');
      let message = '';
      try {
        await listBoardCards(staticContext(backend, { ...emptyConfig(), disabled: ['off'] }), {
          board: 'off',
        });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain('off');
    });

    await it('renders the CLI lines for boards and cards', async () => {
      const { boards } = await listBoards(createDemoContext(NOW));
      const line = boardLine(boards.find((b) => b.id === 'relaunch')!);
      expect(line).toContain('relaunch-board  relaunch  Website relaunch');
      expect(line).toContain('https://boards.example.org/b/relaunch');
      const { cards } = await listBoardCards(createDemoContext(NOW), { board: 'relaunch', mine: 'all' });
      const card = cardLine(cards.find((c) => c.title === 'Write the start page copy')!);
      expect(card).toContain('[todo] Write the start page copy');
      expect(card).toContain('(To do)');
      expect(card).toContain('due 2026-11-20');
    });
  });
};
