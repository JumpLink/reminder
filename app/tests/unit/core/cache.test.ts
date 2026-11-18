import { describe, expect, it } from '@gjsify/unit';
import { createMemoryCacheStore, guardCache, type CacheEntry } from '@reminder/core';

const entry = (body: string): CacheEntry => ({ body, version: 'v1', fetchedAt: '2026-11-18T08:00:00Z' });

export default async () => {
  await describe('memory cache store', async () => {
    await it('replaces a whole entry per source and treats absence as a miss', async () => {
      const store = createMemoryCacheStore();
      const key = { account: 'work', source: 'cal-a' };
      expect(await store.get(key)).toBe(null);
      await store.put(key, entry('one'));
      await store.put(key, { ...entry('two'), version: null });
      const got = await store.get(key);
      expect(got?.body).toBe('two');
      expect(got?.version).toBe(null);
      expect(store.entries().length).toBe(1);
    });

    await it('clears one account or everything, and repeating is fine', async () => {
      const store = createMemoryCacheStore();
      await store.put({ account: 'a', source: 's' }, entry('x'));
      await store.put({ account: 'b', source: 's' }, entry('y'));
      await store.clear('a');
      await store.clear('a');
      expect(store.entries().length).toBe(1);
      await store.clear();
      expect(store.entries().length).toBe(0);
    });
  });

  await describe('guarded cache (disabled sources)', async () => {
    await it('never stores or serves a disabled source', async () => {
      const inner = createMemoryCacheStore();
      const off = { account: 'a', source: 'off' };
      const on = { account: 'a', source: 'on' };
      await inner.put(off, entry('old'));
      const guarded = guardCache(inner, (k) => k.source !== 'off');
      expect(await guarded.get(off)).toBe(null);
      await guarded.put(off, entry('new'));
      expect((await inner.get(off))?.body).toBe('old');
      await guarded.put(on, entry('fresh'));
      expect((await guarded.get(on))?.body).toBe('fresh');
      await guarded.delete(off);
      expect(await inner.get(off)).toBe(null);
    });
  });
};
