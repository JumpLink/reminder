import { describe, expect, it } from '@gjsify/unit';
import {
  BackendAuthError,
  BackendError,
  BackendUnavailableError,
  SYNC_INTERVAL_MS,
  SYNC_MAX_INTERVAL_MS,
  SYNC_MAX_PER_HOST,
  SyncHttpError,
  UnreadableAnswerError,
  backoffMs,
  classifyFetchError,
  createMemoryCacheStore,
  createSyncService,
  enabledSyncSources,
  type CacheKey,
  type FetchResult,
  type SourceStatus,
  type SyncSource,
} from '@reminder/core';

const MIN = 60_000;
const START = Date.parse('2026-11-18T08:00:00Z');

const flush = async () => {
  for (let i = 0; i < 40; i++) await Promise.resolve();
};

/** A hand-driven clock and timer: nothing fires unless `advance` says so. */
function fakeTime() {
  let now = START;
  let nextId = 1;
  let timers: { id: number; at: number; fn: () => void }[] = [];
  return {
    clock: { now: () => now },
    scheduler: {
      setTimeout(fn: () => void, ms: number) {
        const id = nextId++;
        timers.push({ id, at: now + ms, fn });
        return id;
      },
      clearTimeout(handle: unknown) {
        timers = timers.filter((t) => t.id !== handle);
      },
    },
    pending: () => timers.length,
    nextIn: () => (timers.length === 0 ? null : Math.min(...timers.map((t) => t.at)) - now),
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        now = Math.max(now, due.at);
        due.fn();
        await flush();
      }
      now = target;
      await flush();
    },
  };
}

type Script = (key: CacheKey, previous: string | null) => Promise<FetchResult>;

function fakeNet(script: Script) {
  const calls: { key: CacheKey; previous: string | null }[] = [];
  const port = (key: CacheKey, previous: string | null) => {
    calls.push({ key: { ...key }, previous });
    return script(key, previous);
  };
  return { port, calls };
}

const changed = (body: string, version: string | null = 'v1'): Promise<FetchResult> =>
  Promise.resolve({ kind: 'changed', body, version });

const a: SyncSource = { key: { account: 'work', source: 'cal-a' }, kind: 'caldav', host: 'dav.example.org' };
const b: SyncSource = { key: { account: 'work', source: 'cal-b' }, kind: 'caldav', host: 'dav.example.org' };

function setup(script: Script, sources: SyncSource[] = [a]) {
  const time = fakeTime();
  const cache = createMemoryCacheStore();
  const net = fakeNet(script);
  const service = createSyncService({
    cache,
    fetch: net.port,
    clock: time.clock,
    scheduler: time.scheduler,
    sources,
  });
  const log: { key: CacheKey; status: SourceStatus; body: string | null }[] = [];
  service.subscribe((key, status, entry) => log.push({ key, status, body: entry ? entry.body : null }));
  return { time, cache, net, service, log };
}

export default async () => {
  await describe('sync: cache first, then fetch', async () => {
    await it('publishes the cached entry with its fetch time before any fetch', async () => {
      const gate: { release: () => void } = { release: () => undefined };
      const s = setup(
        () =>
          new Promise(
            (resolve) => (gate.release = () => resolve({ kind: 'changed', body: 'new', version: 'v2' })),
          ),
      );
      await s.cache.put(a.key, { body: 'old', version: 'v1', fetchedAt: '2026-11-17T20:00:00.000Z' });
      await s.service.start();
      await flush();
      expect(s.net.calls.length).toBe(1);
      expect(s.net.calls[0].previous).toBe('v1');
      expect(s.log.length).toBe(1);
      expect(s.log[0].body).toBe('old');
      expect(s.log[0].status.state.kind).toBe('pending');
      expect(s.log[0].status.lastSuccessAt).toBe('2026-11-17T20:00:00.000Z');
      gate.release();
      await flush();
      expect(s.log.length).toBe(2);
      expect(s.log[1].body).toBe('new');
      expect(s.log[1].status.state.kind).toBe('current');
      expect((await s.cache.get(a.key))?.body).toBe('new');
    });

    await it('tells never fetched from fetched', async () => {
      const s = setup(() => changed('x'));
      await s.service.start();
      expect(s.log[0].status.lastSuccessAt).toBe(null);
      await flush();
      expect(s.service.status(a.key)?.lastSuccessAt).toBe(new Date(START).toISOString());
    });
  });

  await describe('sync: intervals and back-off', async () => {
    await it('refetches after the interval of the source kind', async () => {
      const s = setup(() => changed('x'), [a, { ...b, kind: 'eds', host: 'local' }]);
      await s.service.start();
      await flush();
      expect(s.net.calls.length).toBe(2);
      await s.time.advance(SYNC_INTERVAL_MS.eds);
      expect(s.net.calls.length).toBe(3);
      expect(s.net.calls[2].key.source).toBe('cal-b');
      await s.time.advance(SYNC_INTERVAL_MS.eds);
      expect(s.net.calls.length).toBe(4);
      await s.time.advance(SYNC_INTERVAL_MS.caldav - 2 * SYNC_INTERVAL_MS.eds);
      expect(s.net.calls.length).toBe(5);
      expect(s.net.calls[4].key.source).toBe('cal-a');
    });

    await it('doubles the wait per failure up to 30 minutes, and a success resets it', async () => {
      let fail = true;
      const s = setup(() => (fail ? Promise.reject(new BackendError('offline')) : changed('x')));
      await s.cache.put(a.key, { body: 'kept', version: 'v0', fetchedAt: '2026-11-17T20:00:00.000Z' });
      await s.service.start();
      await flush();
      const waits: number[] = [];
      for (let i = 0; i < 6; i++) {
        waits.push(s.time.nextIn() as number);
        await s.time.advance(s.time.nextIn() as number);
      }
      expect(waits.join(',')).toBe([10, 20, 30, 30, 30, 30].map((m) => m * MIN).join(','));
      expect(s.service.status(a.key)?.state.kind).toBe('stale');
      fail = false;
      await s.time.advance(s.time.nextIn() as number);
      expect(s.service.status(a.key)?.state.kind).toBe('current');
      expect(s.time.nextIn()).toBe(SYNC_INTERVAL_MS.caldav);
      expect(backoffMs(SYNC_INTERVAL_MS.zenkit, 5)).toBe(SYNC_MAX_INTERVAL_MS);
    });
  });

  await describe('sync: failures are states', async () => {
    await it('401 stops every retry until the person re-authenticates', async () => {
      let reject = true;
      const s = setup(() =>
        reject ? Promise.reject(new BackendAuthError('no', 'http', 401)) : changed('x'),
      );
      await s.service.start();
      await flush();
      expect(s.service.status(a.key)?.state.kind).toBe('auth-rejected');
      expect(s.time.pending()).toBe(0);
      s.service.refresh();
      s.service.focus();
      await s.time.advance(2 * 60 * MIN);
      expect(s.net.calls.length).toBe(1);
      reject = false;
      s.service.reauthenticated('other');
      await flush();
      expect(s.net.calls.length).toBe(1);
      s.service.reauthenticated('work');
      await flush();
      expect(s.net.calls.length).toBe(2);
      expect(s.service.status(a.key)?.state.kind).toBe('current');
    });

    await it('403 carries a reason, 429 uses the server retry-after', async () => {
      let mode: 'forbidden' | 'limited' | 'limited-silent' = 'forbidden';
      const s = setup(() => {
        if (mode === 'forbidden') return Promise.reject(new SyncHttpError('not yours', 403));
        if (mode === 'limited') return Promise.reject(new SyncHttpError('slow down', 429, 90_000));
        return Promise.reject(new SyncHttpError('slow down', 429));
      });
      await s.service.start();
      await flush();
      const denied = s.service.status(a.key)?.state;
      expect(denied?.kind).toBe('no-access');
      expect(denied?.kind === 'no-access' ? denied.reason : '').toBe('not yours');
      mode = 'limited';
      s.service.refresh(a.key);
      await flush();
      const limited = s.service.status(a.key)?.state;
      expect(limited?.kind).toBe('rate-limited');
      expect(s.time.nextIn()).toBe(90_000);
      expect(limited?.kind === 'rate-limited' ? limited.retryAt : '').toBe(
        new Date(START + 90_000).toISOString(),
      );
      mode = 'limited-silent';
      await s.time.advance(90_000);
      expect(s.service.status(a.key)?.state.kind).toBe('rate-limited');
      expect(s.time.nextIn()).toBe(backoffMs(SYNC_INTERVAL_MS.caldav, 3));
    });

    await it('an unreadable answer leaves the cache entry byte-identical', async () => {
      let mode: 'unreadable' | 'offline' = 'unreadable';
      const s = setup(() =>
        Promise.reject(
          mode === 'unreadable' ? new UnreadableAnswerError('bad') : new BackendUnavailableError('gone'),
        ),
      );
      const before = {
        body: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
        version: 'v7',
        fetchedAt: '2026-11-17T20:00:00.000Z',
      };
      await s.cache.put(a.key, before);
      await s.service.start();
      await flush();
      expect(s.service.status(a.key)?.state.kind).toBe('unreadable');
      mode = 'offline';
      s.service.refresh();
      await flush();
      expect(s.service.status(a.key)?.state.kind).toBe('stale');
      const after = await s.cache.get(a.key);
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
      expect(s.service.status(a.key)?.lastSuccessAt).toBe(before.fetchedAt);
    });

    await it('maps errors to states', async () => {
      expect(classifyFetchError(new BackendAuthError('x', 'http', 401)).kind).toBe('auth-rejected');
      expect(classifyFetchError(new BackendError('x', 'http', 403)).kind).toBe('no-access');
      expect(classifyFetchError(new BackendError('x', 'http', 429)).kind).toBe('rate-limited');
      expect(classifyFetchError(new SyncHttpError('x', 503, 5000)).retryAfterMs).toBe(5000);
      expect(classifyFetchError(new SyncHttpError('x', 503, 5000)).kind).toBe('rate-limited');
      expect(classifyFetchError(new BackendError('x', 'http', 503)).kind).toBe('stale');
      expect(classifyFetchError(new BackendError('timeout')).kind).toBe('stale');
      expect(classifyFetchError(new Error('boom')).kind).toBe('stale');
      expect(classifyFetchError(new UnreadableAnswerError('x')).kind).toBe('unreadable');
    });
  });

  await describe('sync: unchanged', async () => {
    await it('updates only the fetch time and the state', async () => {
      let answer: FetchResult = { kind: 'changed', body: 'one', version: 'v1' };
      const s = setup(() => Promise.resolve(answer));
      await s.service.start();
      await flush();
      answer = { kind: 'unchanged' };
      await s.time.advance(SYNC_INTERVAL_MS.caldav);
      expect(s.net.calls[1].previous).toBe('v1');
      const entry = await s.cache.get(a.key);
      expect(entry?.body).toBe('one');
      expect(entry?.version).toBe('v1');
      expect(entry?.fetchedAt).toBe(new Date(START + SYNC_INTERVAL_MS.caldav).toISOString());
      expect(s.service.status(a.key)?.state.kind).toBe('current');
    });
  });

  await describe('sync: triggers', async () => {
    await it('focus skips a fresh source, refetches an old one, and refresh(key) hits one', async () => {
      const s = setup(() => changed('x'), [a, b]);
      await s.service.start();
      await flush();
      s.service.focus();
      await flush();
      expect(s.net.calls.length).toBe(2);
      await s.time.advance(60_000);
      s.service.focus();
      await flush();
      expect(s.net.calls.length).toBe(4);
      s.service.refresh(b.key);
      await flush();
      expect(s.net.calls.length).toBe(5);
      expect(s.net.calls[4].key.source).toBe('cal-b');
    });
  });

  await describe('sync: disabled sources', async () => {
    await it('never schedules a disabled source and follows runtime changes', async () => {
      const accounts = [{ id: 'work' }, { id: 'home' }];
      const all = [a, b];
      const s = setup(() => changed('x'), enabledSyncSources(accounts, ['work:cal-b'], all));
      await s.service.start();
      await flush();
      expect(s.net.calls.map((c) => c.key.source).join(',')).toBe('cal-a');
      await s.service.setSources(enabledSyncSources(accounts, [], all));
      await flush();
      expect(s.net.calls.map((c) => c.key.source).join(',')).toBe('cal-a,cal-b');
      await s.service.setSources(enabledSyncSources(accounts, ['work:cal-a'], all));
      expect(s.service.status(a.key)).toBe(null);
      expect(s.time.pending()).toBe(1);
      await s.time.advance(10 * MIN);
      expect(s.net.calls.filter((c) => c.key.source === 'cal-a').length).toBe(1);
    });

    await it('treats a source that moved to another host as new', async () => {
      const s = setup(() => changed('x'), [a]);
      await s.service.start();
      await flush();
      expect(s.net.calls.length).toBe(1);
      await s.service.setSources([{ ...a, host: 'moved.example.org' }]);
      await flush();
      expect(s.net.calls.length).toBe(2);
      expect(s.time.pending()).toBe(1);
      expect(s.service.status(a.key)?.state.kind).toBe('current');
    });
  });

  await describe('sync: concurrency and stop', async () => {
    await it('runs at most two fetches per host, other hosts in parallel', async () => {
      const sources: SyncSource[] = ['1', '2', '3', '4'].map((n) => ({
        ...a,
        key: { account: 'work', source: `c${n}` },
      }));
      sources.push({ key: { account: 'home', source: 'x' }, kind: 'caldav', host: 'other.example.org' });
      let running = 0;
      let peak = 0;
      const releases: (() => void)[] = [];
      const s = setup(
        () =>
          new Promise((resolve) => {
            running += 1;
            peak = Math.max(peak, running);
            releases.push(() => {
              running -= 1;
              resolve({ kind: 'changed', body: 'x', version: null });
            });
          }),
        sources,
      );
      await s.service.start();
      await flush();
      expect(SYNC_MAX_PER_HOST).toBe(2);
      expect(s.net.calls.length).toBe(3);
      releases.shift()?.();
      await flush();
      expect(s.net.calls.length).toBe(4);
      while (releases.length > 0) {
        releases.shift()?.();
        await flush();
      }
      expect(s.net.calls.length).toBe(5);
      expect(peak).toBe(3);
    });

    await it('stop leaves no timer and ignores a result still in flight', async () => {
      let release: () => void = () => undefined;
      const s = setup(
        () =>
          new Promise(
            (resolve) => (release = () => resolve({ kind: 'changed', body: 'late', version: 'v9' })),
          ),
        [a, b],
      );
      await s.service.start();
      await flush();
      s.service.stop();
      expect(s.time.pending()).toBe(0);
      release();
      await flush();
      expect(s.time.pending()).toBe(0);
      expect(await s.cache.get(a.key)).toBe(null);
      expect(s.log.filter((l) => l.status.state.kind === 'current').length).toBe(0);
    });

    await it('unsubscribe stops notifications', async () => {
      const s = setup(() => changed('x'));
      let seen = 0;
      const off = s.service.subscribe(() => {
        seen += 1;
      });
      off();
      await s.service.start();
      await flush();
      expect(seen).toBe(0);
    });
  });
};
