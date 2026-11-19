import { describe, expect, it } from '@gjsify/unit';
import { BackendAuthError } from '@gjsify/pim';
import { boardSourceContract, classifyCard, type BoardSource } from '@reminder/core';
import { apiKeyAuth, createOpenProjectSource } from '@reminder/openproject';

import { fixtures, startFakeOpenProject, TOKEN, type FakeOpenProject } from './fake-openproject-server.ts';

async function withServer(fn: (server: FakeOpenProject) => Promise<void>) {
  const server = await startFakeOpenProject();
  try {
    await fn(server);
  } finally {
    await server.close();
  }
}

const sourceFor = (server: FakeOpenProject, token = TOKEN, pageSize?: number): BoardSource =>
  createOpenProjectSource({ id: 'work', baseUrl: server.url, auth: apiKeyAuth(token), pageSize });

const idsOf = (page: Awaited<ReturnType<BoardSource['listCards']>>): string[] =>
  page.kind === 'changed' ? page.cards.map((card) => card.ref.id) : [];

export default async () => {
  await describe('BoardSource contract (OpenProject)', async () => {
    await withServer(async (server) => {
      for (const check of boardSourceContract(() => sourceFor(server))) {
        await it(check.name, async () => {
          await check.run();
        });
      }
    });
  });

  await describe('OpenProject board source', async () => {
    await it('is read-only and says what it can do', async () => {
      await withServer(async (server) => {
        const info = sourceFor(server).describe();
        expect(info.type).toBe('openproject');
        expect(info.canWrite).toBe(false);
        expect(info.hasWatchers).toBe(true);
        expect(info.changeToken).toBe(true);
      });
    });

    await it('authenticates as Basic apikey and names me from /users/me', async () => {
      await withServer(async (server) => {
        const me = await sourceFor(server).whoAmI();
        expect(me.id).toBe('7');
        expect(me.displayName).toBe('Pat Example');
        expect(me.isMe).toBe(true);
        const expected = `Basic ${Buffer.from(`apikey:${TOKEN}`).toString('base64')}`;
        expect(server.requests[0].authorization).toBe(expected);
      });
    });

    await it('unites assignee and responsible without duplicates', async () => {
      await withServer(async (server) => {
        const page = await sourceFor(server).listCards((await sourceFor(server).listBoards())[0]);
        // 103 is both assignee and responsible; 101 assignee only; 102 responsible only.
        expect(idsOf(page).sort().join()).toBe('101,102,103');
        const queries = server.requests
          .filter((request) => request.path.endsWith('/work_packages'))
          .map((request) => request.query.get('filters') ?? '');
        expect(queries.some((q) => q.includes('"assignee"'))).toBe(true);
        expect(queries.some((q) => q.includes('"responsible"'))).toBe(true);
      });
    });

    await it('flags watched cards and unites watching with assigned', async () => {
      await withServer(async (server) => {
        const source = sourceFor(server);
        const board = (await source.listBoards())[0];
        const page = await source.listCards(board, { mine: 'watching' });
        expect(idsOf(page).sort().join()).toBe('101,102,103,104');
        const cards = page.kind === 'changed' ? page.cards : [];
        expect(cards.find((card) => card.ref.id === '104')?.watchedByMe).toBe(true);
        expect(cards.find((card) => card.ref.id === '101')?.watchedByMe).toBe(false);
      });
    });

    await it('maps status, due date, version, links and people onto the card', async () => {
      await withServer(async (server) => {
        const source = sourceFor(server);
        const board = (await source.listBoards())[0];
        expect(board.url).toBe(`${server.url}projects/workshop`);
        const page = await source.listCards(board);
        const card = (page.kind === 'changed' ? page.cards : []).find((entry) => entry.ref.id === '102');
        expect(card?.sourceColumn).toBe('In progress');
        expect(card?.version).toBe('4');
        expect(card?.url).toBe(`${server.url}work_packages/102`);
        expect(card?.assignees[0].id).toBe('7');
        expect(card?.assignees[0].isMe).toBe(true);
        const due = (page.kind === 'changed' ? page.cards : []).find((entry) => entry.ref.id === '101');
        expect(due?.due).toBe('2026-12-01');
        expect(due?.updated).toBe('2026-11-18T08:00:00Z');
      });
    });

    await it('walks every page by page number', async () => {
      await withServer(async (server) => {
        const source = sourceFor(server, TOKEN, 2);
        const board = (await source.listBoards())[0];
        const page = await source.listCards(board, { mine: 'all' });
        expect(idsOf(page).length).toBe(6);
        const offsets = server.requests
          .filter((request) => request.path === '/api/v3/projects/1/work_packages')
          .filter((request) => request.query.get('pageSize') === '2')
          .filter((request) => (request.query.get('filters') ?? '').indexOf('watcher') === -1)
          .map((request) => request.query.get('offset'));
        expect(offsets.join()).toBe('1,2,3,4');
      });
    });

    await it('puts isClosed statuses in the done lane, and keeps them out by default', async () => {
      await withServer(async (server) => {
        const source = sourceFor(server);
        const board = (await source.listBoards())[0];
        const columns = await source.listColumns(board);
        expect(columns.map((column) => column.name).join()).toBe('New,In progress,Closed,Rejected');
        expect(columns[0].initial).toBe(true);
        expect(columns[2].closed).toBe(true);

        expect(idsOf(await source.listCards(board)).includes('105')).toBe(false);
        const page = await source.listCards(board, { includeClosed: true });
        const closed = (page.kind === 'changed' ? page.cards : []).find((card) => card.ref.id === '105');
        expect(closed?.closed).toBe(true);
        expect(classifyCard('openproject', closed!, columns)).toBe('done');
        const open = (await source.listCards(board)).kind === 'changed';
        expect(open).toBe(true);
      });
    });

    await it('answers unchanged until a work package of the query is edited', async () => {
      await withServer(async (server) => {
        const source = sourceFor(server);
        const board = (await source.listBoards())[0];
        const first = await source.listCards(board);
        const token = first.kind === 'changed' ? first.token : null;
        expect((await source.listCards(board, undefined, token)).kind).toBe('unchanged');

        const edited = server.data.workPackages.find((w) => w.id === 101)!;
        edited.updatedAt = '2026-11-19T09:00:00.000Z';
        expect((await source.listCards(board, undefined, token)).kind).toBe('changed');
      });
    });

    await it('notices a work package that left the query', async () => {
      await withServer(async (server) => {
        const source = sourceFor(server);
        const board = (await source.listBoards())[0];
        const first = await source.listCards(board);
        const token = first.kind === 'changed' ? first.token : null;
        server.data.workPackages.find((w) => w.id === 102)!.responsible = 8;
        expect((await source.listCards(board, undefined, token)).kind).toBe('changed');
      });
    });

    await it('caps the answer and reports what it left out', async () => {
      await withServer(async (server) => {
        const source = sourceFor(server);
        const board = (await source.listBoards())[0];
        const page = await source.listCards(board, { limit: 2 });
        expect(page.kind === 'changed' ? page.cards.length : -1).toBe(2);
        expect(page.kind === 'changed' ? page.omitted : -1).toBe(1);
      });
    });

    await it('rejects a bad token as an auth error without leaking it', async () => {
      await withServer(async (server) => {
        const source = sourceFor(server, 'wrong-secret-token');
        let caught: unknown = null;
        try {
          await source.listBoards();
        } catch (err) {
          caught = err;
        }
        expect(caught instanceof BackendAuthError).toBe(true);
        expect(String((caught as Error).message).includes('wrong-secret-token')).toBe(false);
      });
    });

    await it('refuses a base URL that is not http(s)', async () => {
      let caught = false;
      try {
        createOpenProjectSource({ baseUrl: 'ftp://projects.example.org/', auth: apiKeyAuth('x') });
      } catch {
        caught = true;
      }
      expect(caught).toBe(true);
      expect(fixtures().projects.length).toBe(2);
    });
  });
};
