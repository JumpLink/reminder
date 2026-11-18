/**
 * The CacheStore port — what a source answered last time, so a view can show it before (or
 * without) the network. See docs/adr/0010.
 *
 * An entry is the RAW response plus a version marker; the core parses cached text with the code
 * that parses a network answer. The cache is derived data: any entry may be gone at any time, so
 * every read can be a miss and a corrupt entry is one too.
 */

/** One source: an account and a calendar uid / board id inside it. */
export interface CacheKey {
  account: string;
  source: string;
}

export interface CacheEntry {
  /** The response exactly as the source sent it (iCalendar text, or JSON for a board). */
  body: string;
  /** ETag, ctag or `updatedAt` — opaque here, interpreted by the source adapter. Null if none. */
  version: string | null;
  /** When it was fetched, as a UTC ISO instant. */
  fetchedAt: string;
}

export interface CacheStore {
  /** The entry, or null for a miss — absent, unreadable and corrupt all look the same. */
  get(key: CacheKey): Promise<CacheEntry | null>;
  /** Replace the whole entry. */
  put(key: CacheKey, entry: CacheEntry): Promise<void>;
  /** Remove one entry; repeating it is fine. */
  delete(key: CacheKey): Promise<void>;
  /** Remove every entry of one account, or all entries without an argument. Safe to repeat. */
  clear(account?: string): Promise<void>;
}

const sameKey = (a: CacheKey, b: CacheKey) => a.account === b.account && a.source === b.source;

/** In-memory store: tests, and hosts that want no persistence. */
export function createMemoryCacheStore(): CacheStore & { entries(): { key: CacheKey; entry: CacheEntry }[] } {
  let rows: { key: CacheKey; entry: CacheEntry }[] = [];
  return {
    async get(key) {
      const row = rows.find((r) => sameKey(r.key, key));
      return row ? { ...row.entry } : null;
    },
    async put(key, entry) {
      rows = rows.filter((r) => !sameKey(r.key, key));
      rows.push({ key: { ...key }, entry: { ...entry } });
    },
    async delete(key) {
      rows = rows.filter((r) => !sameKey(r.key, key));
    },
    async clear(account) {
      rows = account === undefined ? [] : rows.filter((r) => r.key.account !== account);
    },
    entries: () => rows.map((r) => ({ key: { ...r.key }, entry: { ...r.entry } })),
  };
}

/**
 * Disabled sources get no cache (ADR 0006): `put` is dropped and `get` misses, whatever the inner
 * store holds. `isEnabled` is the core's one answer to "is this source on".
 */
export function guardCache(inner: CacheStore, isEnabled: (key: CacheKey) => boolean): CacheStore {
  return {
    async get(key) {
      return isEnabled(key) ? inner.get(key) : null;
    },
    async put(key, entry) {
      if (isEnabled(key)) await inner.put(key, entry);
    },
    delete: (key) => inner.delete(key),
    clear: (account) => inner.clear(account),
  };
}
