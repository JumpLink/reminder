import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';
import { cacheRoot, createFsCacheStore } from '@reminder/cache-fs';

const entry = {
  body: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
  version: 'etag-1',
  fetchedAt: '2026-11-18T08:00:00Z',
};

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'reminder-cache-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export default async () => {
  await describe('cache-fs', async () => {
    await it('locates the root under XDG_CACHE_HOME, else ~/.cache', async () => {
      expect(cacheRoot('reminder', { XDG_CACHE_HOME: '/x/cache' })).toBe('/x/cache/reminder');
      expect(cacheRoot('reminder', { HOME: '/home/someone' })).toBe('/home/someone/.cache/reminder');
    });

    await it('round-trips an entry and leaves no temporary file behind', async () => {
      await withDir(async (dir) => {
        const store = createFsCacheStore(join(dir, 'reminder'));
        const key = { account: 'default', source: 'https://dav.example.org/cal/work/' };
        expect(await store.get(key)).toBe(null);
        await store.put(key, entry);
        const got = await store.get(key);
        expect(got?.body).toBe(entry.body);
        expect(got?.version).toBe('etag-1');
        const files = await readdir(join(dir, 'reminder', 'default'));
        expect(files.length).toBe(1);
        expect(files[0].endsWith('.json')).toBe(true);
      });
    });

    await it('keeps files private to the user', async () => {
      await withDir(async (dir) => {
        const root = join(dir, 'reminder');
        const store = createFsCacheStore(root);
        await store.put({ account: 'a', source: 's' }, entry);
        const file = join(root, 'a', 's.json');
        expect((await stat(file)).mode & 0o777).toBe(0o600);
        expect((await stat(join(root, 'a'))).mode & 0o777).toBe(0o700);
      });
    });

    await it('keeps odd names inside the root and apart', async () => {
      await withDir(async (dir) => {
        const root = join(dir, 'reminder');
        const store = createFsCacheStore(root);
        await store.put({ account: '../evil', source: '../../x' }, entry);
        await store.put({ account: 'a', source: 'x'.repeat(500) }, { ...entry, body: 'long' });
        expect((await store.get({ account: '../evil', source: '../../x' }))?.body).toBe(entry.body);
        expect((await store.get({ account: 'a', source: 'x'.repeat(500) }))?.body).toBe('long');
        expect((await readdir(dir)).join(',')).toBe('reminder');
      });
    });

    await it('treats a corrupt or mismatched file as a miss', async () => {
      await withDir(async (dir) => {
        const root = join(dir, 'reminder');
        const store = createFsCacheStore(root);
        const key = { account: 'a', source: 's' };
        await store.put(key, entry);
        const file = join(root, 'a', 's.json');
        await writeFile(file, '{not json');
        expect(await store.get(key)).toBe(null);
        await writeFile(file, JSON.stringify({ key: { account: 'a', source: 'other' }, entry }));
        expect(await store.get(key)).toBe(null);
        await writeFile(file, JSON.stringify({ key, entry: { body: 1 } }));
        expect(await store.get(key)).toBe(null);
      });
    });

    await it('deletes one entry, one account, or everything — repeatably', async () => {
      await withDir(async (dir) => {
        const root = join(dir, 'reminder');
        const store = createFsCacheStore(root);
        await store.put({ account: 'a', source: '1' }, entry);
        await store.put({ account: 'a', source: '2' }, entry);
        await store.put({ account: 'b', source: '1' }, entry);
        await store.delete({ account: 'a', source: '1' });
        await store.delete({ account: 'a', source: '1' });
        expect(await store.get({ account: 'a', source: '1' })).toBe(null);
        expect((await store.get({ account: 'a', source: '2' }))?.body).toBe(entry.body);
        await store.clear('a');
        expect(await store.get({ account: 'a', source: '2' })).toBe(null);
        expect((await store.get({ account: 'b', source: '1' }))?.body).toBe(entry.body);
        await store.clear();
        await store.clear();
        expect(await store.get({ account: 'b', source: '1' })).toBe(null);
      });
    });
  });
};
