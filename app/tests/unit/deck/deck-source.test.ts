import { describe, expect, it } from '@gjsify/unit';
import { BackendAuthError } from '@gjsify/pim';
import { HostLimiter } from '@gjsify/http-client';
import { createDeckBoardSource } from '@reminder/deck';
import { boardSourceContract, classifyColumn, type BoardSource } from '@reminder/core';

import { DECK_PASSWORD, DECK_USER, startFakeDeck, type FakeDeck } from './fake-deck-server.ts';

const sourceFor = (deck: FakeDeck, extra: { identity?: { id: string } } = {}): BoardSource =>
  createDeckBoardSource({
    baseUrl: deck.baseUrl,
    auth: { type: 'app-password', username: DECK_USER, password: DECK_PASSWORD },
    limiter: new HostLimiter(),
    ...extra,
  });

async function withDeck(fn: (deck: FakeDeck) => Promise<void>): Promise<void> {
  const deck = await startFakeDeck();
  try {
    await fn(deck);
  } finally {
    await deck.close();
  }
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a rejection');
}

export default async () => {
  await describe('BoardSource contract (Deck, fake server)', async () => {
    for (const check of boardSourceContract(async () => {
      const deck = await startFakeDeck();
      const source = sourceFor(deck);
      // The server lives for the process; the fake holds no timers, and close() runs below.
      closers.push(() => deck.close());
      return source;
    })) {
      await it(check.name, async () => {
        await check.run();
      });
    }
    await it('closes the contract servers', async () => {
      for (const close of closers.splice(0)) await close();
    });
  });

  await describe('Deck source', async () => {
    await it('reads boards, skipping archived ones, with a link into the Deck UI', async () => {
      await withDeck(async (deck) => {
        const boards = await sourceFor(deck).listBoards();
        expect(boards.map((b) => b.title).join(',')).toBe('Workshop,Garden');
        expect(boards[0].url).toBe(`${deck.baseUrl}index.php/apps/deck/board/10`);
      });
    });

    await it('maps stacks to columns in the server order, dropping deleted stacks', async () => {
      await withDeck(async (deck) => {
        const source = sourceFor(deck);
        const [workshop] = await source.listBoards();
        const columns = await source.listColumns(workshop);
        expect(columns.map((c) => c.name).join(',')).toBe('Backlog,Zu erledigen,In Arbeit,Erledigt');
        expect(columns[0].closed).toBe(null);
        expect(columns[0].initial).toBe(null);
      });
    });

    await it('maps assignees, labels, due date and link; watching is unknown', async () => {
      await withDeck(async (deck) => {
        const source = sourceFor(deck);
        const [workshop] = await source.listBoards();
        const page = await source.listCards(workshop, { mine: 'all' });
        expect(page.kind).toBe('changed');
        if (page.kind !== 'changed') return;
        const plane = page.cards.find((c) => c.ref.id === '101');
        const shelf = page.cards.find((c) => c.ref.id === '104');
        const lamp = page.cards.find((c) => c.ref.id === '102');
        if (!plane || !shelf || !lamp) throw new Error('fixture cards missing');
        expect(plane.sourceColumn).toBe('Zu erledigen');
        expect(plane.due).toBe('2026-12-01T00:00:00Z');
        expect(plane.assignees.length).toBe(1);
        expect(plane.assignees[0].id).toBe(DECK_USER);
        expect(plane.assignees[0].isMe).toBe(true);
        expect(plane.labels[0].name).toBe('Urgent');
        expect(plane.labels[0].color).toBe('ff7a66');
        expect(plane.url).toBe(`${deck.baseUrl}index.php/apps/deck/board/10/card/101`);
        expect(plane.watchedByMe).toBe(null);
        expect(shelf.assignees.map((u) => `${u.id}:${u.isMe}`).join(',')).toBe(`${DECK_USER}:true,bob:false`);
        expect(lamp.assignees[0].isMe).toBe(false);
        expect(lamp.assignees[0].displayName).toBe('Bob Example');
        const assigned = await source.listCards(workshop);
        expect(
          assigned.kind === 'changed' &&
            assigned.cards
              .map((c) => c.ref.id)
              .sort()
              .join(','),
        ).toBe('101,104');
      });
    });

    await it('treats archived and done cards as closed, archived ones only on request', async () => {
      await withDeck(async (deck) => {
        const source = sourceFor(deck);
        const [workshop] = await source.listBoards();
        const open = await source.listCards(workshop, { mine: 'all' });
        const all = await source.listCards(workshop, { mine: 'all', includeClosed: true });
        if (open.kind !== 'changed' || all.kind !== 'changed') throw new Error('expected changed');
        expect(open.cards.some((c) => c.closed === true)).toBe(false);
        const closed = all.cards
          .filter((c) => c.closed === true)
          .map((c) => c.ref.id)
          .sort();
        expect(closed.join(',')).toBe('105,106');
        expect(deck.requests.some((r) => r.path.endsWith('/stacks/archived'))).toBe(true);
      });
    });

    await it('answers "unchanged" with exactly one request, and changed once something moved', async () => {
      await withDeck(async (deck) => {
        const source = sourceFor(deck, { identity: { id: DECK_USER } });
        const [workshop] = await source.listBoards();
        const first = await source.listCards(workshop);
        if (first.kind !== 'changed' || first.token === null) throw new Error('expected a token');

        deck.requests.length = 0;
        const again = await source.listCards(workshop, undefined, first.token);
        expect(again.kind).toBe('unchanged');
        expect(deck.requests.length).toBe(1);
        expect(deck.requests[0].path.endsWith('/boards/10/stacks')).toBe(true);
        expect(deck.requests[0].headers['if-none-match']).toBe(first.token);

        deck.touch();
        const moved = await source.listCards(workshop, undefined, first.token);
        expect(moved.kind).toBe('changed');
      });
    });

    await it('sends the OCS header and credentials, and looks the user up once', async () => {
      await withDeck(async (deck) => {
        const source = sourceFor(deck);
        const [workshop] = await source.listBoards();
        await source.listCards(workshop);
        await source.listCards(workshop);
        const lookups = deck.requests.filter((r) => r.path === '/ocs/v2.php/cloud/user');
        expect(lookups.length).toBe(1);
        for (const request of deck.requests) {
          expect(request.headers['ocs-apirequest']).toBe('true');
          expect(request.headers.authorization?.startsWith('Basic ')).toBe(true);
        }
        const me = await source.whoAmI();
        expect(me.id).toBe(DECK_USER);
        expect(me.displayName).toBe('Alice Example');
      });
    });

    await it('skips the identity lookup when the uid is configured', async () => {
      await withDeck(async (deck) => {
        const source = sourceFor(deck, { identity: { id: DECK_USER } });
        const [workshop] = await source.listBoards();
        await source.listCards(workshop);
        expect(deck.requests.some((r) => r.path.startsWith('/ocs/'))).toBe(false);
      });
    });

    await it('turns a 401 into an auth error that never carries the password', async () => {
      await withDeck(async (deck) => {
        deck.rejectCredentials();
        const err = await rejection(sourceFor(deck).listBoards());
        expect(err instanceof BackendAuthError).toBe(true);
        expect(err.message.includes(DECK_PASSWORD)).toBe(false);
        expect(JSON.stringify(err).includes(DECK_PASSWORD)).toBe(false);
        expect(err.message.includes(Buffer.from(`${DECK_USER}:${DECK_PASSWORD}`).toString('base64'))).toBe(
          false,
        );
      });
    });

    await it('lands German and English stack names in the four lanes', async () => {
      await withDeck(async (deck) => {
        const source = sourceFor(deck);
        const boards = await source.listBoards();
        const lanes: Record<string, string> = {};
        for (const board of boards) {
          const columns = await source.listColumns(board);
          for (const column of columns) lanes[column.name] = classifyColumn('deck', column);
        }
        expect(lanes['Backlog']).toBe('backlog');
        expect(lanes['Zu erledigen']).toBe('todo');
        expect(lanes['In Arbeit']).toBe('in-progress');
        expect(lanes['Erledigt']).toBe('done');
        expect(lanes['To do']).toBe('todo');
      });
    });
  });
};

const closers: (() => Promise<void>)[] = [];
