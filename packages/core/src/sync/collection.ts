/**
 * Adapter from a CalDAV collection to the sync service's fetch port (docs/adr/0018).
 *
 * The core imports no driver: the app binds a driver's delta read to `CollectionReader`. The cache
 * body is a JSON array of `{ href, etag, ics }` — see `encodeCollectionBody`.
 */

import type { CollectionDelta, CollectionItem, CollectionPrevious } from '@gjsify/pim';

import type { CacheKey, CacheStore } from '../cache.ts';
import type { SyncFetch } from './types.ts';

export type CollectionReader = (key: CacheKey, previous: CollectionPrevious | null) => Promise<CollectionDelta>;

/**
 * The raw iCalendar texts, each with the href and etag a later delta merges on. JSON keeps the
 * texts byte-exact (CRLF, folding) and the entry one atomic file; a bare concatenation of
 * VCALENDARs would lose the href and etag, and the delta could not tell which item moved.
 */
export function encodeCollectionBody(items: CollectionItem[]): string {
  return JSON.stringify(items.map((i) => ({ href: i.href, etag: i.etag, ics: i.ical })));
}

/** The items of a cached body, or null when it is not one (a corrupt entry is a miss). */
export function decodeCollectionBody(body: string): CollectionItem[] | null {
  try {
    const rows: unknown = JSON.parse(body);
    if (!Array.isArray(rows)) return null;
    const items: CollectionItem[] = [];
    for (const r of rows as Record<string, unknown>[]) {
      if (typeof r?.href !== 'string' || typeof r.ics !== 'string') return null;
      if (r.etag !== null && typeof r.etag !== 'string') return null;
      items.push({ href: r.href, etag: r.etag, ical: r.ics });
    }
    return items;
  } catch {
    return null;
  }
}

/**
 * `previousVersion` alone is not enough for a delta — the items are needed too — so the adapter
 * reads the entry itself. A body that does not decode, or a marker that does not match the entry,
 * means no previous: a full read, never an error.
 */
export function createCollectionSyncFetch(cache: CacheStore, read: CollectionReader): SyncFetch {
  return async (key, previousVersion) => {
    let previous: CollectionPrevious | null = null;
    if (previousVersion !== null) {
      const entry = await cache.get(key).catch(() => null);
      const items = entry && entry.version === previousVersion ? decodeCollectionBody(entry.body) : null;
      if (items) previous = { marker: previousVersion, items };
    }
    const result = await read({ ...key }, previous);
    return result.kind === 'unchanged'
      ? { kind: 'unchanged' }
      : { kind: 'changed', body: encodeCollectionBody(result.items), version: result.marker };
  };
}
