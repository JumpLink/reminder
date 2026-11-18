/**
 * What every frontend needs: the configuration and the backend it names. Both are created on
 * first use, so `--help` touches neither the file nor EDS.
 *
 * With several accounts (docs/adr/0005) one backend is built per account and a multiplexer put in
 * front, so everything above this file sees one `CalendarBackend` whose uids carry their account.
 * With a single account there is no multiplexer and no prefix: that path is exactly what it was.
 */

import { createCaldavBackend } from '@reminder/caldav';
import {
  _,
  ConfigError,
  createMultiBackend,
  fmt,
  UnsupportedAuthError,
  type AccountConfig,
  type BackendAccount,
  type CalendarBackend,
  type ReminderConfig,
} from '@reminder/core';
import { createEdsBackend } from '@reminder/eds';

import { loadConfig } from './config.ts';

export interface Context {
  config(): ReminderConfig;
  backend(): CalendarBackend;
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
): CalendarBackend {
  switch (account.backend) {
    case 'eds':
      return createEdsBackend();
    case 'caldav': {
      const caldav = account.caldav;
      if (!caldav) throw new ConfigError(about(_('backend "caldav" needs a caldav section'), account, named));
      if (caldav.auth !== 'basic') throw new UnsupportedAuthError(caldav.auth);
      const password = env[caldav.passwordEnv];
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
): BackendAccount[] {
  const named = config.accounts.length > 1;
  return config.accounts.map((account) => ({
    id: account.id,
    backend: createAccountBackend(account, env, named),
  }));
}

export function createBackend(
  config: ReminderConfig,
  env: Record<string, string | undefined> = process.env,
): CalendarBackend {
  const accounts = createAccountBackends(config, env);
  return accounts.length > 1 ? createMultiBackend(accounts) : accounts[0].backend;
}

export function createContext(): Context {
  let config: ReminderConfig | null = null;
  let backend: CalendarBackend | null = null;
  const context: Context = {
    config: () => (config ??= loadConfig()),
    backend: () => (backend ??= createBackend(context.config())),
  };
  return context;
}

/** A context over a given backend and config — tests and embedders. */
export function staticContext(backend: CalendarBackend, config: ReminderConfig): Context {
  return { config: () => config, backend: () => backend };
}
