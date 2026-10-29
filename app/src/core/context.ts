/**
 * What every frontend needs: the configuration and the backend it names. Both are created on
 * first use, so `--help` touches neither the file nor EDS.
 */

import { createCaldavBackend } from '@reminder/caldav';
import {
  _,
  ConfigError,
  fmt,
  UnsupportedAuthError,
  type CalendarBackend,
  type ReminderConfig,
} from '@reminder/core';
import { createEdsBackend } from '@reminder/eds';

import { loadConfig } from './config.ts';

export interface Context {
  config(): ReminderConfig;
  backend(): CalendarBackend;
}

export function createBackend(
  config: ReminderConfig,
  env: Record<string, string | undefined> = process.env,
): CalendarBackend {
  switch (config.backend) {
    case 'eds':
      return createEdsBackend();
    case 'caldav': {
      const caldav = config.caldav;
      if (!caldav) throw new ConfigError(_('backend "caldav" needs a caldav section'));
      if (caldav.auth !== 'basic') throw new UnsupportedAuthError(caldav.auth);
      const password = env[caldav.passwordEnv];
      if (!password)
        throw new ConfigError(fmt(_('export the CalDAV password as {name}'), { name: caldav.passwordEnv }));
      return createCaldavBackend({ url: caldav.url, username: caldav.username, password });
    }
  }
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
