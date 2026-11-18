import { describe, expect, it } from '@gjsify/unit';
import {
  BackendError,
  classifyFetchError,
  createCollectionSyncFetch,
  createMemoryCacheStore,
  decodeCollectionBody,
  type CollectionPrevious,
} from '@reminder/core';
import { createCaldavDeltaReader } from '@gjsify/pim/caldav';

import { startFakeDav } from './fake-dav-server.ts';

const USER = 'user@example.org';
const PASSWORD = 'not-a-real-password';

const event = (uid: string, summary: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:20261012T080000Z\r\nSUMMARY:${summary}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

type Dav = Awaited<ReturnType<typeof startFakeDav>>;

async function withServer(sync: 'token' | 'ctag', fn: (dav: Dav) => Promise<void>) {
  const dav = await startFakeDav({
    user: USER,
    password: PASSWORD,
    sync,
    resources: {
      '/cal/events/a.ics': event('a', 'Alpha'),
      '/cal/events/b.ics': event('b', 'Beta'),
      '/cal/events/c.ics': event('c', 'Gamma'),
    },
  });
  try {
    await fn(dav);
  } finally {
    await dav.close();
  }
}

const reader = (dav: Dav, password = PASSWORD) =>
  createCaldavDeltaReader({ url: dav.url, username: USER, password });
const events = (dav: Dav) => `${dav.url}cal/events/`;
const paths = (dav: Dav, from: number) =>
  dav.requests
    .slice(from)
    .map(
      (r) =>
        `${r.method} ${r.body.includes('sync-collection') ? 'sync' : r.body.includes('multiget') ? 'multiget' : r.body.includes('calendar-query') ? 'query' : 'propfind'}`,
    );

async function first(dav: Dav) {
  const r = reader(dav);
  const got = await r.read(events(dav), 'event', null);
  if (got.kind !== 'changed') throw new Error('first read must be a full one');
  const previous: CollectionPrevious = { marker: got.marker, items: got.items };
  return { r, got, previous };
}

const summaries = (items: { ical: string }[]) =>
  items
    .map((i) => /SUMMARY:(.*)\r/.exec(i.ical)?.[1] ?? '?')
    .sort()
    .join(',');

export default async () => {
  await describe('caldav delta reader', async () => {
    await it('reads everything the first time, and an unchanged collection costs one request', async () => {
      await withServer('token', async (dav) => {
        const { r, got, previous } = await first(dav);
        expect(summaries(got.items)).toBe('Alpha,Beta,Gamma');
        const mark = dav.requests.length;
        const again = await r.read(events(dav), 'event', previous);
        expect(again.kind).toBe('unchanged');
        expect(dav.requests.length - mark).toBe(1);
        expect(paths(dav, mark).join()).toBe('PROPFIND propfind');
      });
    });

    await it('fetches only the changed item through the sync token', async () => {
      await withServer('token', async (dav) => {
        const { r, previous } = await first(dav);
        dav.tamper('/cal/events/b.ics', event('b', 'Beta 2'));
        const mark = dav.requests.length;
        const got = await r.read(events(dav), 'event', previous);
        expect(got.kind).toBe('changed');
        if (got.kind !== 'changed') return;
        expect(summaries(got.items)).toBe('Alpha,Beta 2,Gamma');
        expect(paths(dav, mark).join()).toBe('PROPFIND propfind,REPORT sync,REPORT multiget');
        const multiget = dav.requests.slice(mark).find((x) => x.body.includes('multiget'));
        expect(multiget?.body.includes('b.ics')).toBe(true);
        expect(multiget?.body.includes('a.ics')).toBe(false);
        expect(got.marker === previous.marker).toBe(false);
      });
    });

    await it('keeps a task that changed in the same collection out of an event delta', async () => {
      await withServer('token', async (dav) => {
        const { r, previous } = await first(dav);
        dav.tamper(
          '/cal/events/t.ics',
          'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VTODO\r\nUID:t\r\nSUMMARY:Task\r\nEND:VTODO\r\nEND:VCALENDAR\r\n',
        );
        const got = await r.read(events(dav), 'event', previous);
        if (got.kind !== 'changed') throw new Error('expected a change');
        expect(summaries(got.items)).toBe('Alpha,Beta,Gamma');
      });
    });

    await it('drops a deleted item through the sync token without fetching anything', async () => {
      await withServer('token', async (dav) => {
        const { r, previous } = await first(dav);
        dav.remove('/cal/events/c.ics');
        const mark = dav.requests.length;
        const got = await r.read(events(dav), 'event', previous);
        if (got.kind !== 'changed') throw new Error('expected a change');
        expect(summaries(got.items)).toBe('Alpha,Beta');
        expect(paths(dav, mark).join()).toBe('PROPFIND propfind,REPORT sync');
      });
    });

    await it('falls back to a full read when the server rejects the sync token', async () => {
      await withServer('token', async (dav) => {
        const { r, previous } = await first(dav);
        dav.tamper('/cal/events/a.ics', event('a', 'Alpha 2'));
        dav.expireTokens();
        const mark = dav.requests.length;
        const got = await r.read(events(dav), 'event', previous);
        if (got.kind !== 'changed') throw new Error('expected a change');
        expect(summaries(got.items)).toBe('Alpha 2,Beta,Gamma');
        expect(paths(dav, mark).join()).toBe('PROPFIND propfind,REPORT sync,REPORT query,REPORT multiget');
      });
    });

    await it('reads fully on change from a server with a ctag but no sync token, one request when unchanged', async () => {
      await withServer('ctag', async (dav) => {
        const { r, previous } = await first(dav);
        let mark = dav.requests.length;
        expect((await r.read(events(dav), 'event', previous)).kind).toBe('unchanged');
        expect(dav.requests.length - mark).toBe(1);
        dav.tamper('/cal/events/a.ics', event('a', 'Alpha 2'));
        mark = dav.requests.length;
        const got = await r.read(events(dav), 'event', previous);
        if (got.kind !== 'changed') throw new Error('expected a change');
        expect(summaries(got.items)).toBe('Alpha 2,Beta,Gamma');
        expect(paths(dav, mark).join()).toBe('PROPFIND propfind,REPORT query,REPORT multiget');
      });
    });

    await it('treats a marker it cannot read as no marker', async () => {
      await withServer('token', async (dav) => {
        const { r, previous } = await first(dav);
        const got = await r.read(events(dav), 'event', { ...previous, marker: 'not json' });
        expect(got.kind).toBe('changed');
      });
    });

    await it('maps a rejected password to http/401, which classifies as auth-rejected', async () => {
      await withServer('token', async (dav) => {
        let err: unknown = null;
        try {
          await reader(dav, 'wrong').read(events(dav), 'event', null);
        } catch (e) {
          err = e;
        }
        expect(err instanceof BackendError).toBe(true);
        expect((err as BackendError).domain).toBe('http');
        expect((err as BackendError).code).toBe(401);
        expect(classifyFetchError(err).kind).toBe('auth-rejected');
      });
    });

    await it('names an unknown collection as a BackendError', async () => {
      await withServer('token', async (dav) => {
        let err: unknown = null;
        try {
          await reader(dav).read(`${dav.url}cal/nope/`, 'event', null);
        } catch (e) {
          err = e;
        }
        expect(err instanceof BackendError).toBe(true);
      });
    });
  });

  await describe('collection sync fetch adapter', async () => {
    await it('stores raw texts as the body and returns unchanged for an unchanged server', async () => {
      await withServer('token', async (dav) => {
        const cache = createMemoryCacheStore();
        const r = reader(dav);
        const key = { account: 'a', source: events(dav) };
        const fetchOne = createCollectionSyncFetch(cache, (k, previous) =>
          r.read(k.source, 'event', previous),
        );

        const first = await fetchOne(key, null);
        if (first.kind !== 'changed') throw new Error('expected a change');
        const items = decodeCollectionBody(first.body);
        expect(items?.length).toBe(3);
        expect(items?.some((i) => i.ical === event('a', 'Alpha'))).toBe(true);
        await cache.put(key, { body: first.body, version: first.version, fetchedAt: '2026-11-18T08:00:00Z' });

        const mark = dav.requests.length;
        expect((await fetchOne(key, first.version)).kind).toBe('unchanged');
        expect(dav.requests.length - mark).toBe(1);

        dav.tamper('/cal/events/a.ics', event('a', 'Alpha 2'));
        const second = await fetchOne(key, first.version);
        if (second.kind !== 'changed') throw new Error('expected a change');
        expect(decodeCollectionBody(second.body)?.some((i) => i.ical.includes('Alpha 2'))).toBe(true);
      });
    });

    await it('reads fully when the cached body is corrupt', async () => {
      await withServer('token', async (dav) => {
        const cache = createMemoryCacheStore();
        const r = reader(dav);
        const key = { account: 'a', source: events(dav) };
        await cache.put(key, { body: 'garbage', version: 'v1', fetchedAt: '2026-11-18T08:00:00Z' });
        const fetchOne = createCollectionSyncFetch(cache, (k, previous) =>
          r.read(k.source, 'event', previous),
        );
        const got = await fetchOne(key, 'v1');
        expect(got.kind).toBe('changed');
      });
    });
  });
};
