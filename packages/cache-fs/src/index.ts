/**
 * `@reminder/cache-fs` — the CacheStore driver for hosts with a file system (docs/adr/0010).
 *
 * Layout: `<root>/<account>/<source>.json`, one file per source holding the key and the entry. The
 * cache is derived: any read problem (missing, unreadable, corrupt, a key that does not match) is
 * a miss, and nothing here may make a caller fail because of a stale or damaged file.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { CacheEntry, CacheKey, CacheStore } from '@reminder/core';

/** `$XDG_CACHE_HOME/<dirName>`, falling back to `~/.cache/<dirName>`. */
export function cacheRoot(dirName: string, env: Record<string, string | undefined> = process.env): string {
  const base = env.XDG_CACHE_HOME || join(env.HOME || homedir(), '.cache');
  return join(base, dirName);
}

const MAX_NAME = 120;

/** A file-system safe, collision-free name: percent-encoded, or a hash when it would be too long. */
function safeName(part: string): string {
  const encoded = encodeURIComponent(part).replace(/\./g, '%2E');
  if (encoded !== '' && encoded.length <= MAX_NAME) return encoded;
  return `h-${createHash('sha256').update(part).digest('hex')}`;
}

function isEntry(value: unknown): value is CacheEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.body === 'string' &&
    (v.version === null || typeof v.version === 'string') &&
    typeof v.fetchedAt === 'string'
  );
}

export function createFsCacheStore(root: string): CacheStore {
  const accountDir = (account: string) => join(root, safeName(account));
  const fileOf = (key: CacheKey) => join(accountDir(key.account), `${safeName(key.source)}.json`);

  return {
    async get(key) {
      try {
        const parsed: unknown = JSON.parse(await readFile(fileOf(key), 'utf8'));
        if (!parsed || typeof parsed !== 'object') return null;
        const record = parsed as { key?: Partial<CacheKey>; entry?: unknown };
        if (record.key?.account !== key.account || record.key?.source !== key.source) return null;
        return isEntry(record.entry) ? record.entry : null;
      } catch {
        return null;
      }
    },
    async put(key, entry) {
      const file = fileOf(key);
      await mkdir(accountDir(key.account), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ key, entry }), { mode: 0o600 });
        await rename(temporary, file);
      } catch (err) {
        await rm(temporary, { force: true });
        throw err;
      }
    },
    async delete(key) {
      await rm(fileOf(key), { force: true });
    },
    async clear(account) {
      await rm(account === undefined ? root : accountDir(account), { recursive: true, force: true });
    },
  };
}
