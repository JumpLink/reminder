import { describe, expect, it } from '@gjsify/unit';
import { BackendAuthError, BackendError } from '@gjsify/pim';
import {
  ForbiddenError,
  HostLimiter,
  HttpClient,
  NetworkError,
  NotFoundError,
  RateLimitedError,
  ServerError,
  TimeoutError,
  UnauthorizedError,
  paginateAll,
  parseLinkHeader,
  parseRetryAfter,
} from '@gjsify/http-client';

import { json, startFakeRest, type FakeRest } from './fake-rest-server.ts';

const PASSWORD = 'not-a-real-password';
const TOKEN = 'not-a-real-token';

async function withServer(fn: (rest: FakeRest) => Promise<void>) {
  const rest = await startFakeRest();
  try {
    await fn(rest);
  } finally {
    await rest.close();
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

const basic = (rest: FakeRest) =>
  new HttpClient({
    baseUrl: rest.url,
    auth: { type: 'app-password', username: 'user@example.org', password: PASSWORD },
    limiter: new HostLimiter(),
  });

export default async () => {
  await describe('http client', async () => {
    await it('sends basic and bearer credentials and parses JSON with its etag', async () => {
      await withServer(async (rest) => {
        rest.on('/api/boards', (_req, res) => json(res, 200, [{ id: 1 }], { ETag: '"v1"' }));
        const result = await basic(rest).getJson<{ id: number }[]>('boards');
        expect(result.status).toBe('ok');
        if (result.status === 'ok') {
          expect(result.data[0].id).toBe(1);
          expect(result.etag).toBe('"v1"');
        }
        const expected = `Basic ${Buffer.from(`user@example.org:${PASSWORD}`).toString('base64')}`;
        expect(rest.requests[0].headers.authorization).toBe(expected);

        const bearer = new HttpClient({ baseUrl: rest.url, auth: { type: 'bearer', token: TOKEN } });
        await bearer.getJson('boards');
        expect(rest.requests[1].headers.authorization).toBe(`Bearer ${TOKEN}`);
      });
    });

    await it('posts a JSON body, sends a header key, and keeps the key out of errors', async () => {
      await withServer(async (rest) => {
        rest.on('/api/query', (req, res) => json(res, 200, { echo: JSON.parse(req.body) }));
        rest.on('/api/denied', (_req, res) => json(res, 429, {}, { 'Retry-After': '3' }));
        const client = new HttpClient({
          baseUrl: rest.url,
          auth: { type: 'header', name: 'X-Api-Key', value: TOKEN },
          limiter: new HostLimiter(),
        });
        const result = await client.postJson<{ echo: { limit: number } }>('query', { limit: 5 });
        expect(result.status === 'ok' && result.data.echo.limit).toBe(5);
        expect(rest.requests[0].method).toBe('POST');
        expect(rest.requests[0].headers['x-api-key']).toBe(TOKEN);
        expect(rest.requests[0].headers['content-type']).toBe('application/json');
        expect(rest.requests[0].headers.authorization).toBe(undefined);

        const err = await rejection(client.postJson('denied', {}));
        expect(err instanceof RateLimitedError).toBe(true);
        expect((err as RateLimitedError).retryAfterMs).toBe(3000);
        expect(err.message.startsWith('POST ')).toBe(true);
        expect(err.message.includes(TOKEN)).toBe(false);
        expect(JSON.stringify(client).includes(TOKEN)).toBe(false);
      });
    });

    await it('answers a 304 to If-None-Match as unchanged', async () => {
      await withServer(async (rest) => {
        rest.on('/api/boards', (req, res) => {
          if (req.headers['if-none-match'] === '"v1"') {
            res.writeHead(304, { ETag: '"v1"' });
            res.end();
          } else json(res, 200, [], { ETag: '"v1"' });
        });
        const client = basic(rest);
        const first = await client.getJson('boards');
        const etag = first.etag;
        const second = await client.getJson('boards', { etag });
        expect(second.status).toBe('unchanged');
        expect(second.etag).toBe('"v1"');
        expect(rest.requests.length).toBe(2);
      });
    });

    await it('maps 401, 403, 404 and 5xx onto typed errors that are backend errors', async () => {
      await withServer(async (rest) => {
        for (const [path, status] of [
          ['a', 401],
          ['b', 403],
          ['c', 404],
          ['d', 503],
        ] as const) {
          rest.on(`/api/${path}`, (_req, res) => json(res, status, { message: `secret ${PASSWORD}` }));
        }
        const client = basic(rest);
        const unauthorized = await rejection(client.getJson('a'));
        expect(unauthorized instanceof UnauthorizedError).toBe(true);
        expect(unauthorized instanceof BackendAuthError).toBe(true);
        expect((unauthorized as UnauthorizedError).code).toBe(401);
        expect((unauthorized as UnauthorizedError).domain).toBe('http');

        const forbidden = await rejection(client.getJson('b'));
        expect(forbidden instanceof ForbiddenError).toBe(true);
        expect(forbidden instanceof BackendError).toBe(true);
        expect((await rejection(client.getJson('c'))) instanceof NotFoundError).toBe(true);
        const server = await rejection(client.getJson('d'));
        expect(server instanceof ServerError).toBe(true);
        expect((server as ServerError).status).toBe(503);
      });
    });

    await it('turns a 429 with Retry-After into retryAfterMs', async () => {
      await withServer(async (rest) => {
        rest.on('/api/slow', (_req, res) => json(res, 429, {}, { 'Retry-After': '7' }));
        rest.on('/api/bare', (_req, res) => json(res, 429, {}));
        const client = basic(rest);
        const err = await rejection(client.getJson('slow'));
        expect(err instanceof RateLimitedError).toBe(true);
        expect((err as RateLimitedError).retryAfterMs).toBe(7000);
        expect(((await rejection(client.getJson('bare'))) as RateLimitedError).retryAfterMs).toBe(undefined);
      });
      expect(parseRetryAfter('120')).toBe(120000);
      expect(
        parseRetryAfter('Wed, 21 Oct 2026 07:28:10 GMT', Date.parse('Wed, 21 Oct 2026 07:28:00 GMT')),
      ).toBe(10000);
      expect(parseRetryAfter('soon')).toBe(undefined);
    });

    await it('times out a stalled server', async () => {
      await withServer(async (rest) => {
        rest.on('/api/hang', () => {});
        const err = await rejection(basic(rest).getJson('hang', { timeoutMs: 150 }));
        expect(err instanceof TimeoutError).toBe(true);
      });
    });

    await it('reports an unreachable server as a network error', async () => {
      const rest = await startFakeRest();
      const client = basic(rest);
      await rest.close();
      expect((await rejection(client.getJson('boards'))) instanceof NetworkError).toBe(true);
    });

    await it('follows Link rel=next and stays on the origin', async () => {
      await withServer(async (rest) => {
        rest.on('/api/items', (req, res) => {
          const page = new URLSearchParams(req.query).get('page') ?? '1';
          if (page === '1') json(res, 200, [1, 2], { Link: '</api/items?page=2>; rel="next"' });
          else json(res, 200, [3]);
        });
        expect((await paginateAll<number>(basic(rest), 'items', { style: 'link' })).join()).toBe('1,2,3');

        rest.on('/api/evil', (_req, res) =>
          json(res, 200, [1], { Link: '<http://example.com/steal>; rel="next"' }),
        );
        await rejection(paginateAll(basic(rest), 'evil', { style: 'link' }));
        expect(rest.requests.every((r) => r.path.startsWith('/api/'))).toBe(true);
      });
      const refs = parseLinkHeader(
        '<https://example.org/a>; rel="prev", <https://example.org/b>; rel="next last"',
      );
      expect(refs[1].rel.join()).toBe('next,last');
    });

    await it('pages by offset until a short page, and caps runaway servers', async () => {
      await withServer(async (rest) => {
        rest.on('/api/cards', (req, res) => {
          const q = new URLSearchParams(req.query);
          const offset = Number(q.get('offset'));
          const size = Number(q.get('pageSize'));
          const all = [1, 2, 3, 4, 5];
          json(res, 200, { cards: all.slice(offset, offset + size) });
        });
        const items = (body: unknown) => (body as { cards: number[] }).cards;
        const got = await paginateAll<number>(basic(rest), 'cards', { style: 'offset', pageSize: 2, items });
        expect(got.join()).toBe('1,2,3,4,5');

        rest.on('/api/endless', (_req, res) => json(res, 200, [1, 2]));
        const err = await rejection(
          paginateAll(basic(rest), 'endless', { style: 'offset', pageSize: 2, maxPages: 3 }),
        );
        expect(err.message).toContain('more than 3 pages');
      });
    });

    await it('pages by page number when the offset counts pages', async () => {
      await withServer(async (rest) => {
        rest.on('/api/pages', (req, res) => {
          const q = new URLSearchParams(req.query);
          const page = Number(q.get('offset'));
          const size = Number(q.get('pageSize'));
          const all = [1, 2, 3, 4, 5];
          json(res, 200, { items: all.slice((page - 1) * size, page * size) });
        });
        const items = (body: unknown) => (body as { items: number[] }).items;
        const got = await paginateAll<number>(basic(rest), 'pages', {
          style: 'offset',
          offsetUnit: 'pages',
          pageSize: 2,
          items,
        });
        expect(got.join()).toBe('1,2,3,4,5');
      });
    });

    await it('limits concurrent requests per host', async () => {
      await withServer(async (rest) => {
        let active = 0;
        let peak = 0;
        rest.on('/api/work', (_req, res) => {
          active += 1;
          peak = Math.max(peak, active);
          setTimeout(() => {
            active -= 1;
            json(res, 200, []);
          }, 40);
        });
        const client = new HttpClient({ baseUrl: rest.url, limiter: new HostLimiter({ maxConcurrent: 2 }) });
        await Promise.all([1, 2, 3, 4, 5].map(() => client.getJson('work')));
        expect(peak).toBe(2);
      });
    });

    await it('never puts a credential into an error message or a serialisation', async () => {
      await withServer(async (rest) => {
        rest.on('/api/a', (_req, res) => json(res, 401, { echo: PASSWORD }));
        rest.on('/api/b', (_req, res) => json(res, 500, { echo: TOKEN }));
        rest.on('/api/c', (_req, res) => res.end(`<html>${PASSWORD}</html>`));
        rest.on('/api/hang', () => {});
        const basicAuth = Buffer.from(`user@example.org:${PASSWORD}`).toString('base64');
        const client = basic(rest);
        const errors = [
          await rejection(client.getJson('a')),
          await rejection(client.getJson('b', { query: { access_token: TOKEN } })),
          await rejection(client.getJson('c')),
          await rejection(client.getJson('hang', { timeoutMs: 100 })),
        ];
        const dead = await startFakeRest();
        const deadClient = basic(dead);
        await dead.close();
        errors.push(await rejection(deadClient.getJson('boards')));
        for (const err of errors) {
          const text = `${err.message} ${JSON.stringify(err)} ${String(err.stack ?? '').split('\n')[0]}`;
          for (const secret of [PASSWORD, TOKEN, basicAuth]) expect(text.includes(secret)).toBe(false);
        }
        expect(JSON.stringify(client).includes(PASSWORD)).toBe(false);
      });
    });

    await it('refuses credentials in the base URL and requests off the origin', async () => {
      let threw = false;
      try {
        new HttpClient({ baseUrl: 'https://user:pw@example.org/' });
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
      const client = new HttpClient({
        baseUrl: 'https://cloud.example.org/api',
        auth: { type: 'bearer', token: TOKEN },
      });
      expect(client.resolve('boards').href).toBe('https://cloud.example.org/api/boards');
      const err = await rejection(client.getJson('https://example.com/other'));
      expect(err instanceof TypeError).toBe(true);
    });
  });
};
