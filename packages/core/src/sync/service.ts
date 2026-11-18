/**
 * The sync service (docs/adr/0017): per source a state, a timer, and a fetch through a port.
 * Pure TypeScript — time and the network come in as ports, so nothing here touches GLib, a global
 * timer or Gtk.
 */

import type { AccountRef } from '../accounts.ts';
import type { CacheEntry, CacheKey, CacheStore } from '../cache.ts';
import { isSourceEnabled, targetOfCacheKey } from '../visibility.ts';
import {
  SYNC_FOCUS_MIN_GAP_MS,
  SYNC_INTERVAL_MS,
  SYNC_MAX_INTERVAL_MS,
  SYNC_MAX_PER_HOST,
} from '../limits.ts';
import { classifyFetchError } from './classify.ts';
import type {
  SourceStatus,
  SyncClock,
  SyncFetch,
  SyncListener,
  SyncScheduler,
  SyncSource,
  SyncState,
} from './types.ts';

/** setTimeout cannot take more than this. */
const MAX_TIMER_MS = 2 ** 31 - 1;

export interface SyncServiceOptions {
  cache: CacheStore;
  fetch: SyncFetch;
  clock: SyncClock;
  scheduler: SyncScheduler;
  /** The enabled sources. Change them later with `setSources`. */
  sources: readonly SyncSource[];
}

export interface SyncService {
  /** Publish the cache of every source, then fetch them all. */
  start(): Promise<void>;
  /** Cancel every timer; results still in flight are ignored. */
  stop(): void;
  /** The window gained focus: refresh what has not been tried lately. */
  focus(): void;
  /** Fetch now — one source, or all. A source rejected with 401 is skipped until `reauthenticated`. */
  refresh(key?: CacheKey): void;
  /** The person signed in again: lift the 401 stop of every source of this account and retry. */
  reauthenticated(account: string): void;
  /** Replace the schedule: new sources are published and fetched, missing ones are dropped. */
  setSources(sources: readonly SyncSource[]): Promise<void>;
  status(key: CacheKey): SourceStatus | null;
  subscribe(listener: SyncListener): () => void;
}

interface Runtime {
  source: SyncSource;
  status: SourceStatus;
  failures: number;
  timer: unknown;
  hasTimer: boolean;
  queued: boolean;
  running: boolean;
  lastAttemptEndedAt: number | null;
}

const idOf = (key: CacheKey): string => `${key.account}\n${key.source}`;

/** Interval after `failures` failures in a row: doubled each time, up to the ceiling. */
export function backoffMs(baseMs: number, failures: number): number {
  return Math.min(baseMs * 2 ** failures, SYNC_MAX_INTERVAL_MS);
}

/** The sources worth scheduling: enabled ones only, through the same rule every frontend uses. */
export function enabledSyncSources(
  accounts: readonly AccountRef[],
  disabled: readonly string[],
  sources: readonly SyncSource[],
): SyncSource[] {
  return sources.filter((s) => isSourceEnabled(disabled, targetOfCacheKey(accounts, s.key)));
}

export function createSyncService(options: SyncServiceOptions): SyncService {
  const { cache, clock, scheduler } = options;
  const runtimes = new Map<string, Runtime>();
  const queues = new Map<string, Runtime[]>();
  const active = new Map<string, number>();
  const listeners = new Set<SyncListener>();
  let started = false;
  let stopped = false;

  const iso = (ms: number): string => new Date(ms).toISOString();

  const emit = (rt: Runtime, entry?: CacheEntry): void => {
    for (const listener of listeners) {
      try {
        listener({ ...rt.source.key }, { state: rt.status.state, lastSuccessAt: rt.status.lastSuccessAt }, entry);
      } catch {
        // A broken view must not stop the others, nor the schedule.
      }
    }
  };

  const safeGet = async (key: CacheKey): Promise<CacheEntry | null> => {
    try {
      return await cache.get(key);
    } catch {
      return null;
    }
  };

  const alive = (rt: Runtime): boolean => !stopped && runtimes.get(idOf(rt.source.key)) === rt;

  const clearTimer = (rt: Runtime): void => {
    if (rt.hasTimer) scheduler.clearTimeout(rt.timer);
    rt.hasTimer = false;
    rt.timer = undefined;
  };

  const schedule = (rt: Runtime, ms: number): void => {
    clearTimer(rt);
    rt.hasTimer = true;
    rt.timer = scheduler.setTimeout(() => {
      rt.hasTimer = false;
      rt.timer = undefined;
      enqueue(rt);
    }, Math.min(Math.max(0, ms), MAX_TIMER_MS));
  };

  const setState = (rt: Runtime, state: SyncState): void => {
    rt.status = { state, lastSuccessAt: rt.status.lastSuccessAt };
  };

  const run = async (rt: Runtime): Promise<void> => {
    const key = rt.source.key;
    const base = SYNC_INTERVAL_MS[rt.source.kind];
    const previous = await safeGet(key);
    let result: Awaited<ReturnType<SyncFetch>> | null = null;
    let failure: ReturnType<typeof classifyFetchError> | null = null;
    try {
      result = await options.fetch({ ...key }, previous?.version ?? null);
    } catch (err) {
      failure = classifyFetchError(err);
    }
    if (!alive(rt)) return;
    rt.lastAttemptEndedAt = clock.now();

    if (failure !== null || result === null) {
      const outcome = failure ?? { kind: 'stale' as const };
      rt.failures += 1;
      if (outcome.kind === 'auth-rejected') {
        setState(rt, { kind: 'auth-rejected' });
        emit(rt);
        return;
      }
      let delay = backoffMs(base, rt.failures);
      if (outcome.kind === 'no-access') setState(rt, { kind: 'no-access', reason: outcome.reason ?? '' });
      else if (outcome.kind === 'rate-limited') {
        if (outcome.retryAfterMs !== undefined) delay = outcome.retryAfterMs;
        setState(rt, { kind: 'rate-limited', retryAt: iso(clock.now() + Math.max(0, delay)) });
      } else setState(rt, { kind: outcome.kind });
      schedule(rt, delay);
      emit(rt);
      return;
    }

    const fetchedAt = iso(clock.now());
    let entry: CacheEntry | null = previous;
    if (result.kind === 'changed') {
      entry = { body: result.body, version: result.version, fetchedAt };
    } else if (previous !== null) {
      entry = { ...previous, fetchedAt };
    }
    if (entry !== null) {
      try {
        await cache.put(key, entry);
      } catch {
        // The cache is derived data; the fresh answer is still published below.
      }
      if (!alive(rt)) return;
    }
    rt.failures = 0;
    rt.status = { state: { kind: 'current' }, lastSuccessAt: fetchedAt };
    schedule(rt, base);
    emit(rt, entry ?? undefined);
  };

  const pump = (host: string): void => {
    const queue = queues.get(host);
    if (!queue) return;
    while (queue.length > 0 && (active.get(host) ?? 0) < SYNC_MAX_PER_HOST) {
      const rt = queue.shift() as Runtime;
      rt.queued = false;
      if (!alive(rt)) continue;
      active.set(host, (active.get(host) ?? 0) + 1);
      rt.running = true;
      void run(rt)
        .catch(() => undefined)
        .then(() => {
          rt.running = false;
          active.set(host, (active.get(host) ?? 1) - 1);
          pump(host);
        });
    }
  };

  function enqueue(rt: Runtime): void {
    if (!alive(rt) || rt.running || rt.queued) return;
    clearTimer(rt);
    rt.queued = true;
    const host = rt.source.host;
    const queue = queues.get(host) ?? [];
    queue.push(rt);
    queues.set(host, queue);
    pump(host);
  }

  const publish = async (rt: Runtime): Promise<void> => {
    const entry = await safeGet(rt.source.key);
    if (!alive(rt)) return;
    rt.status = { state: { kind: 'pending' }, lastSuccessAt: entry?.fetchedAt ?? null };
    emit(rt, entry ?? undefined);
  };

  const add = (source: SyncSource): Runtime => {
    const rt: Runtime = {
      source: { key: { ...source.key }, kind: source.kind, host: source.host },
      status: { state: { kind: 'pending' }, lastSuccessAt: null },
      failures: 0,
      timer: undefined,
      hasTimer: false,
      queued: false,
      running: false,
      lastAttemptEndedAt: null,
    };
    runtimes.set(idOf(source.key), rt);
    return rt;
  };

  const drop = (rt: Runtime): void => {
    clearTimer(rt);
    runtimes.delete(idOf(rt.source.key));
    const queue = queues.get(rt.source.host);
    if (queue) queues.set(rt.source.host, queue.filter((q) => q !== rt));
  };

  for (const source of options.sources) add(source);

  return {
    async start() {
      if (started || stopped) return;
      started = true;
      const all = [...runtimes.values()];
      await Promise.all(all.map(publish));
      for (const rt of all) enqueue(rt);
    },

    stop() {
      stopped = true;
      for (const rt of runtimes.values()) clearTimer(rt);
      queues.clear();
    },

    focus() {
      if (!started || stopped) return;
      const now = clock.now();
      for (const rt of runtimes.values()) {
        const state = rt.status.state;
        if (state.kind === 'auth-rejected') continue;
        if (state.kind === 'rate-limited' && now < Date.parse(state.retryAt)) continue;
        if (rt.lastAttemptEndedAt !== null && now - rt.lastAttemptEndedAt < SYNC_FOCUS_MIN_GAP_MS) continue;
        enqueue(rt);
      }
    },

    refresh(key) {
      if (!started || stopped) return;
      const targets = key === undefined ? [...runtimes.values()] : [runtimes.get(idOf(key))];
      for (const rt of targets) {
        if (rt === undefined || rt.status.state.kind === 'auth-rejected') continue;
        enqueue(rt);
      }
    },

    reauthenticated(account) {
      for (const rt of runtimes.values()) {
        if (rt.source.key.account !== account || rt.status.state.kind !== 'auth-rejected') continue;
        rt.failures = 0;
        setState(rt, { kind: 'pending' });
        emit(rt);
        if (started) enqueue(rt);
      }
    },

    async setSources(sources) {
      if (stopped) return;
      const wanted = new Map(sources.map((s) => [idOf(s.key), s]));
      for (const [id, rt] of runtimes) {
        // A source that moved to another server is a new source: its queue slot and its
        // per-host count belong to the old host.
        if (wanted.get(id)?.host !== rt.source.host) drop(rt);
      }
      const added: Runtime[] = [];
      for (const [id, source] of wanted) {
        const existing = runtimes.get(id);
        if (existing) existing.source = { key: existing.source.key, kind: source.kind, host: existing.source.host };
        else added.push(add(source));
      }
      if (!started) return;
      await Promise.all(added.map(publish));
      for (const rt of added) enqueue(rt);
    },

    status(key) {
      const rt = runtimes.get(idOf(key));
      return rt ? { state: rt.status.state, lastSuccessAt: rt.status.lastSuccessAt } : null;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
