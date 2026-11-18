/**
 * What every frontend needs: the configuration and the backend it names. Both are created on
 * first use, so `--help` touches neither the file nor EDS.
 *
 * With several accounts (docs/adr/0005) one backend is built per account and a multiplexer put in
 * front, so everything above this file sees one `CalendarBackend` whose uids carry their account.
 * With a single account there is no multiplexer and no prefix: that path is exactly what it was.
 */

import { createCaldavBackend } from '@reminder/caldav';
import { cacheRoot, createFsCacheStore } from '@reminder/cache-fs';
import {
  _,
  chainSecretStores,
  ConfigError,
  createEnvSecretStore,
  createMemoryCacheStore,
  createMultiBackend,
  fmt,
  parseSecretRef,
  UnsupportedAuthError,
  type AccountConfig,
  type BackendAccount,
  type CacheStore,
  type CalendarBackend,
  type ReminderConfig,
  type SecretStore,
} from '@reminder/core';
import { createEdsBackend } from '@reminder/eds';
import { createLibsecretStore } from '@reminder/secrets-libsecret';

import { loadConfig } from './config.ts';
import { IDENTITY } from './identity.ts';

export interface Context {
  config(): ReminderConfig;
  backend(): CalendarBackend;
  /** The derived cache (docs/adr/0010), created on first use. */
  cache(): CacheStore;
  /** Environment first, then the Secret Service (docs/adr/0011), created on first use. */
  secrets(): SecretStore;
}

/** The file-system cache under `$XDG_CACHE_HOME/<cacheDirName>`. */
export function createCache(env: Record<string, string | undefined> = process.env): CacheStore {
  return createFsCacheStore(cacheRoot(IDENTITY.cacheDirName, env));
}

/** Stores tried in order: the environment (CLI, CI), then the desktop keyring. */
export function createSecrets(env: Record<string, string | undefined> = process.env): SecretStore {
  return chainSecretStores([
    createEnvSecretStore(env),
    createLibsecretStore({ schemaName: IDENTITY.secretSchemaName, label: IDENTITY.displayName }),
  ]);
}

/**
 * The password of every CalDAV account that names a `passwordSecret`, by account id. Accounts
 * without one are absent; a secret that cannot be read is a ConfigError saying what to do, with no
 * value in it.
 */
export async function resolveSecretPasswords(
  config: ReminderConfig,
  store: SecretStore,
): Promise<Map<string, string>> {
  const passwords = new Map<string, string>();
  for (const account of config.accounts) {
    const reference = account.caldav?.passwordSecret;
    if (reference === undefined) continue;
    const found = await store.lookup(parseSecretRef(reference));
    if (found.status === 'found') passwords.set(account.id, found.value);
    else if (found.status === 'missing')
      throw new ConfigError(fmt(_('no secret stored for "{ref}"'), { ref: reference }));
    else
      throw new ConfigError(
        fmt(_('secret "{ref}" cannot be read: {reason}'), { ref: reference, reason: found.reason }),
      );
  }
  return passwords;
}

/**
 * Name the account in a message only when there is more than one — the same rule as the target
 * prefix: it appears where there is something to tell apart.
 */
function about(message: string, account: AccountConfig, named: boolean): string {
  return named ? fmt(_('account "{account}": {message}'), { account: account.id, message }) : message;
}

/** The backend one account names. Raises rather than dropping the account from the list. */
export function createAccountBackend(
  account: AccountConfig,
  env: Record<string, string | undefined> = process.env,
  named = false,
  secretPasswords: ReadonlyMap<string, string> = new Map(),
): CalendarBackend {
  switch (account.backend) {
    case 'eds':
      return createEdsBackend();
    case 'caldav': {
      const caldav = account.caldav;
      if (!caldav) throw new ConfigError(about(_('backend "caldav" needs a caldav section'), account, named));
      if (caldav.auth !== 'basic') throw new UnsupportedAuthError(caldav.auth);
      const password =
        caldav.passwordSecret !== undefined ? secretPasswords.get(account.id) : env[caldav.passwordEnv];
      if (!password && caldav.passwordSecret !== undefined) {
        throw new ConfigError(about(_('the passwordSecret has not been resolved yet'), account, named));
      }
      if (!password) {
        throw new ConfigError(
          about(fmt(_('export the CalDAV password as {name}'), { name: caldav.passwordEnv }), account, named),
        );
      }
      return createCaldavBackend({ url: caldav.url, username: caldav.username, password });
    }
  }
}

/**
 * One built backend per configured account, in file order. `reminder accounts` builds them one at
 * a time instead, so a broken account is a line in its output rather than the end of the command.
 */
export function createAccountBackends(
  config: ReminderConfig,
  env: Record<string, string | undefined> = process.env,
  secretPasswords: ReadonlyMap<string, string> = new Map(),
): BackendAccount[] {
  const named = config.accounts.length > 1;
  return config.accounts.map((account) => ({
    id: account.id,
    backend: createAccountBackend(account, env, named, secretPasswords),
  }));
}

export function createBackend(
  config: ReminderConfig,
  env: Record<string, string | undefined> = process.env,
  secretPasswords: ReadonlyMap<string, string> = new Map(),
): CalendarBackend {
  const accounts = createAccountBackends(config, env, secretPasswords);
  return accounts.length > 1 ? createMultiBackend(accounts) : accounts[0].backend;
}

export function createContext(): Context {
  let config: ReminderConfig | null = null;
  let backend: CalendarBackend | null = null;
  let cache: CacheStore | null = null;
  let secrets: SecretStore | null = null;
  const context: Context = {
    config: () => (config ??= loadConfig()),
    backend: () => (backend ??= createBackend(context.config())),
    cache: () => (cache ??= createCache()),
    secrets: () => (secrets ??= createSecrets()),
  };
  return context;
}

/** A context over a given backend and config — tests and embedders. */
export function staticContext(
  backend: CalendarBackend,
  config: ReminderConfig,
  stores: { cache?: CacheStore; secrets?: SecretStore } = {},
): Context {
  return {
    config: () => config,
    backend: () => backend,
    cache: () => stores.cache ?? createMemoryCacheStore(),
    secrets: () => stores.secrets ?? createEnvSecretStore({}),
  };
}
