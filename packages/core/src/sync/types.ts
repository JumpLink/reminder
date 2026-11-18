/**
 * Vocabulary of the sync service (docs/adr/0017). States are values a view renders next to the
 * data it still has; the texts belong to the GUI, not here.
 */

import type { CacheEntry, CacheKey } from '../cache.ts';
import type { SyncSourceKind } from '../limits.ts';

export type SyncState =
  /** No attempt has finished yet; whatever the cache held is shown. */
  | { kind: 'pending' }
  | { kind: 'current' }
  /** Offline, timeout or a server error: the data stays visible. */
  | { kind: 'stale' }
  /** 401. No further attempt until `reauthenticated(account)`. */
  | { kind: 'auth-rejected' }
  /** 403. `reason` is the server's or the backend's own wording. */
  | { kind: 'no-access'; reason: string }
  /** 429 or 503 with Retry-After; `retryAt` is the UTC ISO instant of the next attempt. */
  | { kind: 'rate-limited'; retryAt: string }
  /** The answer could not be parsed; the cache is untouched. */
  | { kind: 'unreadable' };

export interface SourceStatus {
  state: SyncState;
  /** UTC ISO instant of the last success (or of the cached fetch); null = never fetched. */
  lastSuccessAt: string | null;
}

export interface SyncSource {
  key: CacheKey;
  kind: SyncSourceKind;
  /** The server this source lives on; the concurrency cap counts per host. */
  host: string;
}

export type FetchResult =
  | { kind: 'changed'; body: string; version: string | null }
  | { kind: 'unchanged' };

/**
 * The fetch port. `previousVersion` is the marker of the cached entry (null when none). A failure
 * is a throw; `classifyFetchError` maps it to a state.
 */
export type SyncFetch = (key: CacheKey, previousVersion: string | null) => Promise<FetchResult>;

/** Time as a port, so tests drive it by hand. */
export interface SyncClock {
  /** Milliseconds since the epoch. */
  now(): number;
}

export interface SyncScheduler {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type SyncListener = (key: CacheKey, status: SourceStatus, entry?: CacheEntry) => void;
