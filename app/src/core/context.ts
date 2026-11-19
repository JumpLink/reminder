/**
 * What every frontend needs: the configuration and the backend it names. Both are created on
 * first use, so `--help` touches neither the file nor EDS.
 *
 * With several accounts (docs/adr/0005) one backend is built per account and a multiplexer put in
 * front, so everything above this file sees one `CalendarBackend` whose uids carry their account.
 * With a single account there is no multiplexer and no prefix: that path is exactly what it was.
 */

import { createCaldavBackend } from '@gjsify/pim/caldav';
import { cacheRoot, createFsCacheStore } from '@reminder/cache-fs';
import {
  _,
  chainSecretStores,
  ConfigError,
  createEnvSecretStore,
  errorMessage,
  createMemoryCacheStore,
  createMultiBackend,
  fmt,
  guardDisabledCache,
  parseSecretRef,
  UnsupportedAuthError,
  withoutDisabled,
  type AccountConfig,
  type BackendAccount,
  type CacheStore,
  type CalendarBackend,
  type ReminderConfig,
  type SecretStore,
} from '@reminder/core';
import { createEdsBackend } from '@gjsify/pim/eds';
import { createLibsecretStore } from '@reminder/secrets-libsecret';

import { loadConfig } from './config.ts';
import { createDemoContext, demoActive } from './demo/index.ts';
import { IDENTITY } from './identity.ts';

export interface Context {
  config(): ReminderConfig;
  backend(): CalendarBackend;
  /** The derived cache (docs/adr/0010), created on first use. */
  cache(): CacheStore;
  /** Environment first, then the Secret Service (docs/adr/0011), created on first use. */
  secrets(): SecretStore;
  /** One account's own backend, when the context supplies them (demo mode, tests). */
  accountBackend?(account: AccountConfig): CalendarBackend | undefined;
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
 * Like `resolveSecretPasswords`, but one unreadable secret costs only its own account: the GUI
 * shows the accounts that work. The CLI keeps the all-or-nothing version (docs/adr/0005).
 */
export async function resolveSecretPasswordsPerAccount(
  config: ReminderConfig,
  store: SecretStore,
): Promise<{ passwords: Map<string, string>; failures: Map<string, string> }> {
  const passwords = new Map<string, string>();
  const failures = new Map<string, string>();
  const named = config.accounts.length > 1;
  for (const account of config.accounts) {
    try {
      const found = await resolveSecretPasswords({ ...config, accounts: [account] }, store);
      for (const [id, value] of found) passwords.set(id, value);
    } catch (err) {
      failures.set(account.id, about(errorMessage(err), account, named));
    }
  }
  return { passwords, failures };
}

/**
 * Name the account in a message only when there is more than one — the same rule as the target
 * prefix: it appears where there is something to tell apart.
 */
export function about(message: string, account: AccountConfig, named: boolean): string {
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
      return createCaldavBackend({
        url: caldav.url,
        username: caldav.username,
        password,
        prodId: IDENTITY.prodId,
      });
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
  if (demoActive()) return createDemoContext();
  let config: ReminderConfig | null = null;
  let backend: CalendarBackend | null = null;
  let cache: CacheStore | null = null;
  let secrets: SecretStore | null = null;
  const context: Context = {
    config: () => (config ??= loadConfig()),
    // Disabled sources (docs/adr/0006) are cut here, so no frontend can reach one by accident.
    backend: () => (backend ??= withoutDisabled(createBackend(context.config()), context.config().disabled)),
    cache: () =>
      (cache ??= guardDisabledCache(createCache(), context.config().accounts, context.config().disabled)),
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
    backend: () => withoutDisabled(backend, config.disabled),
    cache: () =>
      guardDisabledCache(stores.cache ?? createMemoryCacheStore(), config.accounts, config.disabled),
    secrets: () => stores.secrets ?? createEnvSecretStore({}),
  };
}
