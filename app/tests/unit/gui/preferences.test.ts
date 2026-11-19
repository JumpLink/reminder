import { describe, expect, it } from '@gjsify/unit';
import {
  createMemoryCacheStore,
  parseConfig,
  type CalendarInfo,
  type SecretRef,
  type SecretStore,
} from '@reminder/core';

import { createMemoryConfigStore } from '../../../src/core/config-write.ts';
import { createMemorySettings } from '../../../src/frontends/gui/settings.ts';
import {
  accountRows,
  addCaldavAccount,
  addGrant,
  collectionRows,
  grantRows,
  removeAccount,
  removeGrant,
  setCollectionEnabled,
  targetChoices,
  validateCaldav,
  type PreferencesEnv,
} from '../../../src/frontends/gui/views/preferences/controller.ts';

const list = (uid: string, name: string, kind: CalendarInfo['kind'] = 'reminder'): CalendarInfo => ({
  uid,
  name,
  kind,
  backend: 'eds',
  account: null,
});

function secretStore(): SecretStore & { values: Map<string, string> } {
  const values = new Map<string, string>();
  const key = (r: SecretRef) => `${r.account}:${r.purpose}`;
  return {
    id: 'fake',
    values,
    lookup: async (r) =>
      values.has(key(r)) ? { status: 'found', value: values.get(key(r)) ?? '' } : { status: 'missing' },
    store: async (r, v) => {
      values.set(key(r), v);
      return { status: 'ok' };
    },
    clear: async (r) => {
      values.delete(key(r));
      return { status: 'ok' };
    },
  };
}

function setup() {
  const store = createMemoryConfigStore(
    parseConfig({
      accounts: [
        { id: 'home', backend: 'eds' },
        { id: 'work', backend: 'eds' },
      ],
    }),
  );
  const cache = createMemoryCacheStore();
  const secrets = secretStore();
  let rebuilds = 0;
  const env: PreferencesEnv = {
    store,
    settings: createMemorySettings(),
    secrets: () => secrets,
    cache: () => cache,
    lists: () => [
      { account: 'home', calendars: [list('l1', 'Chores'), list('e1', 'Cal', 'event')] },
      { account: 'work', calendars: [list('l2', 'Chores')] },
    ],
    failures: () => new Map([['work', 'offline']]),
    rebuild: async () => {
      rebuilds++;
    },
  };
  return { env, store, cache, secrets, rebuilds: () => rebuilds };
}

export default async () => {
  await describe('preferences controller', async () => {
    await it('lists accounts with their state and collections with theirs', async () => {
      const { env, store } = setup();
      const rows = accountRows(store.read(), env.failures());
      expect(rows[0].problem).toBe(null);
      expect(rows[1].problem).toBe('offline');
      const collections = collectionRows(store.read(), env.lists(), 'home');
      expect(collections.length).toBe(2);
      expect(collections[0].target.startsWith('home:')).toBe(true);
    });

    await it('disabling drops the cache entry, enabling brings the source back, both rebuild', async () => {
      const { env, store, cache, rebuilds } = setup();
      await cache.put(
        { account: 'home', source: 'l1' },
        { body: 'x', version: null, fetchedAt: '2026-11-19T00:00:00Z' },
      );
      expect((await setCollectionEnabled(env, 'home:l1', false)).ok).toBe(true);
      expect(store.read().disabled.join(',')).toBe('home:l1');
      expect(await cache.get({ account: 'home', source: 'l1' })).toBe(null);
      expect(collectionRows(store.read(), env.lists(), 'home').some((c) => !c.enabled)).toBe(true);
      expect((await setCollectionEnabled(env, 'home:l1', true)).ok).toBe(true);
      expect(store.read().disabled.length).toBe(0);
      expect(rebuilds()).toBe(2);
    });

    await it('adds and removes grants, offering only fitting collections', async () => {
      const { env, store } = setup();
      const config = store.read();
      expect(targetChoices(config, env.lists(), 'calendar.create').length).toBe(1);
      expect(targetChoices(config, env.lists(), 'reminder.update').length).toBe(2);
      await addGrant(env, 'reminder.update', 'home:l1');
      await addGrant(env, 'reminder.update', 'home:l1');
      expect(store.read().grants.length).toBe(1);
      expect(grantRows(store.read(), env.lists())[0].name).toContain('Chores');
      await removeGrant(env, 'reminder.update', 'home:l1');
      expect(store.read().grants.length).toBe(0);
    });

    await it('stores a new CalDAV password in the secret store and not in the config', async () => {
      const { env, store, secrets } = setup();
      const input = { name: 'Dav', url: 'https://dav.example.org/', username: 'amy', password: 'pw-123' };
      const done = await addCaldavAccount(env, input);
      expect(done.ok).toBe(true);
      expect(secrets.values.get('dav:password')).toBe('pw-123');
      expect(JSON.stringify(store.read()).includes('pw-123')).toBe(false);
      expect(store.read().accounts[2].caldav?.passwordSecret).toBe('dav:password');
      expect(validateCaldav({ ...input, url: 'nonsense' }) !== null).toBe(true);
      expect(validateCaldav({ ...input, password: '' }) !== null).toBe(true);
      expect((await addCaldavAccount(env, { ...input, password: '' })).ok).toBe(false);
    });

    await it('removing an account clears its cache and password and refuses the last one', async () => {
      const { env, store, cache, secrets } = setup();
      await addCaldavAccount(env, {
        name: 'Dav',
        url: 'https://dav.example.org/',
        username: 'amy',
        password: 'pw',
      });
      await cache.put(
        { account: 'dav', source: 's' },
        { body: 'x', version: null, fetchedAt: '2026-11-19T00:00:00Z' },
      );
      expect((await removeAccount(env, 'dav')).ok).toBe(true);
      expect(secrets.values.size).toBe(0);
      expect(await cache.get({ account: 'dav', source: 's' })).toBe(null);
      await removeAccount(env, 'work');
      expect((await removeAccount(env, 'home')).ok).toBe(false);
      expect(store.read().accounts.length).toBe(1);
    });
  });
};
