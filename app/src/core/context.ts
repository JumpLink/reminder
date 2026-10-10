/**
 * What every frontend needs: the configuration and the backend it names. Both are created on
 * first use, so `--help` touches neither the file nor EDS.
 */

import type { CalendarBackend, ReminderConfig } from '@reminder/core';
import { createEdsBackend } from '@reminder/eds';

import { loadConfig } from './config.ts';

export interface Context {
  config(): ReminderConfig;
  backend(): CalendarBackend;
}

export function createBackend(config: ReminderConfig): CalendarBackend {
  switch (config.backend) {
    case 'eds':
      return createEdsBackend();
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
