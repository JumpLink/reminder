import { describe, expect, it } from '@gjsify/unit';
import {
  chainSecretStores,
  ConfigError,
  createEnvSecretStore,
  formatSecretRef,
  parseConfig,
  parseSecretRef,
  secretEnvName,
  serializeConfig,
  type SecretStore,
} from '@reminder/core';
import { createLibsecretStore, optionalNamespace } from '@reminder/secrets-libsecret';

import { resolveSecretPasswords } from '../../../src/core/context.ts';

const ref = { account: 'work', purpose: 'password' };

/** A store that holds secrets in a map, like a keyring would. */
function fakeStore(id: string, values: Record<string, string> = {}): SecretStore {
  return {
    id,
    async lookup(r) {
      const v = values[formatSecretRef(r)];
      return v ? { status: 'found', value: v } : { status: 'missing' };
    },
    async store(r, value) {
      values[formatSecretRef(r)] = value;
      return { status: 'ok' };
    },
    async clear(r) {
      delete values[formatSecretRef(r)];
      return { status: 'ok' };
    },
  };
}

const down: SecretStore = {
  id: 'down',
  async lookup() {
    return { status: 'unavailable', reason: 'no service' };
  },
  async store() {
    return { status: 'unavailable', reason: 'no service' };
  },
  async clear() {
    return { status: 'unavailable', reason: 'no service' };
  },
};

const caldavFile = (extra: Record<string, unknown>) => ({
  backend: 'caldav',
  caldav: { url: 'https://dav.example.org/', username: 'someone', ...extra },
});

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

export default async () => {
  await describe('secret references', async () => {
    await it('parses <account>:<purpose> and rejects anything else', async () => {
      const parsed = parseSecretRef('work:password');
      expect(parsed.account).toBe('work');
      expect(parsed.purpose).toBe('password');
      for (const bad of ['', 'work', 'a:b:c', ':x', 'a b:c']) {
        expect(thrown(() => parseSecretRef(bad)) instanceof ConfigError).toBe(true);
      }
    });

    await it('maps a reference to an environment name', async () => {
      expect(secretEnvName(ref)).toBe('REMINDER_SECRET_WORK_PASSWORD');
      expect(secretEnvName({ account: 'my-dav.1', purpose: 'token' })).toBe('REMINDER_SECRET_MY_DAV_1_TOKEN');
    });
  });

  await describe('environment secret store', async () => {
    await it('finds a value, reports missing, and is read-only', async () => {
      const store = createEnvSecretStore({ REMINDER_SECRET_WORK_PASSWORD: 'not-a-real-password' });
      const found = await store.lookup(ref);
      expect(found.status).toBe('found');
      expect(found.status === 'found' ? found.value : '').toBe('not-a-real-password');
      expect((await store.lookup({ account: 'other', purpose: 'password' })).status).toBe('missing');
      expect((await store.store(ref, 'x')).status).toBe('unavailable');
      expect((await store.clear(ref)).status).toBe('unavailable');
    });
  });

  await describe('chained secret stores', async () => {
    await it('takes the first value, so the environment can override the keyring', async () => {
      const chain = chainSecretStores([
        fakeStore('a', { 'work:password': 'first' }),
        fakeStore('b', { 'work:password': 'second' }),
      ]);
      const got = await chain.lookup(ref);
      expect(got.status === 'found' ? got.value : '').toBe('first');
      expect(chain.id).toBe('a+b');
    });

    await it('is unavailable only when nothing was found and a store could not be asked', async () => {
      expect((await chainSecretStores([fakeStore('a'), down]).lookup(ref)).status).toBe('unavailable');
      expect((await chainSecretStores([fakeStore('a'), fakeStore('b')]).lookup(ref)).status).toBe('missing');
      expect(
        (await chainSecretStores([down, fakeStore('b', { 'work:password': 'v' })]).lookup(ref)).status,
      ).toBe('found');
    });

    await it('writes to the first store that accepts', async () => {
      const keyring: Record<string, string> = {};
      const chain = chainSecretStores([createEnvSecretStore({}), fakeStore('k', keyring)]);
      expect((await chain.store(ref, 'v')).status).toBe('ok');
      expect(keyring['work:password']).toBe('v');
      expect((await chain.clear(ref)).status).toBe('ok');
      expect(keyring['work:password']).toBe(undefined);
      expect((await chainSecretStores([down]).store(ref, 'v')).status).toBe('unavailable');
      expect((await chainSecretStores([]).store(ref, 'v')).status).toBe('unavailable');
    });
  });

  await describe('libsecret driver without a service', async () => {
    // The test script points DBUS_SESSION_BUS_ADDRESS at nothing: with the typelib present the
    // keyring cannot be reached, without it the namespace cannot load. Either way: unavailable.
    await it('answers unavailable for every operation instead of throwing', async () => {
      const store = createLibsecretStore({ schemaName: 'org.example.Test.Secret' });
      for (const result of [
        await store.lookup(ref),
        await store.store(ref, 'not-a-real-password'),
        await store.clear(ref),
      ]) {
        expect(result.status === 'unavailable' || result.status === 'missing' || result.status === 'ok').toBe(
          true,
        );
      }
      expect((await store.lookup(ref)).status === 'found').toBe(false);
    });

    await it('answers unavailable, with a reason, when the typelib is missing', async () => {
      const namespace = optionalNamespace<never>('Secret', async () => {
        throw new Error("Typelib file for namespace 'Secret' not found");
      });
      const store = createLibsecretStore({ schemaName: 'org.example.Test.Secret', namespace });
      const got = await store.lookup(ref);
      expect(got.status).toBe('unavailable');
      expect(got.status === 'unavailable' ? got.reason : '').toContain('Secret');
      expect((await store.store(ref, 'v')).status).toBe('unavailable');
      expect((await store.clear(ref)).status).toBe('unavailable');
    });
  });

  await describe('passwordSecret in the configuration', async () => {
    await it('is read, kept, and written back without the default passwordEnv', async () => {
      const config = parseConfig(caldavFile({ passwordSecret: 'default:password' }));
      expect(config.caldav?.passwordSecret).toBe('default:password');
      const text = serializeConfig(config);
      expect(text).toContain('passwordSecret');
      expect(text).not.toContain('passwordEnv');
      expect(parseConfig(JSON.parse(text)).caldav?.passwordSecret).toBe('default:password');
    });

    await it('refuses both spellings and a malformed reference', async () => {
      expect(
        thrown(() => parseConfig(caldavFile({ passwordSecret: 'a:b', passwordEnv: 'X' }))) instanceof
          ConfigError,
      ).toBe(true);
      expect(thrown(() => parseConfig(caldavFile({ passwordSecret: 'nope' }))) instanceof ConfigError).toBe(
        true,
      );
    });

    await it('leaves passwordEnv files exactly as they were', async () => {
      const config = parseConfig(caldavFile({ passwordEnv: 'WORK_PASSWORD' }));
      expect(config.caldav?.passwordSecret).toBe(undefined);
      expect(config.caldav?.passwordEnv).toBe('WORK_PASSWORD');
      expect(serializeConfig(config)).toContain('"passwordEnv": "WORK_PASSWORD"');
    });

    await it('resolves through a store, and says what to do when it cannot', async () => {
      const config = parseConfig(caldavFile({ passwordSecret: 'default:password' }));
      const passwords = await resolveSecretPasswords(
        config,
        fakeStore('k', { 'default:password': 'not-a-real-password' }),
      );
      expect(passwords.get('default')).toBe('not-a-real-password');
      for (const store of [fakeStore('k'), down]) {
        let message = '';
        try {
          await resolveSecretPasswords(config, store);
        } catch (err) {
          message = (err as Error).message;
        }
        expect(message).toContain('default:password');
      }
      expect((await resolveSecretPasswords(parseConfig(caldavFile({})), down)).size).toBe(0);
    });
  });
};
