/**
 * Demo mode (`reminder gui --demo`, `REMINDER_DEMO=1`): the whole app on invented data. The context
 * built here reads no configuration file, asks no secret store, opens no network connection and
 * talks to no EDS; writes land in memory and vanish with the process.
 */

import {
  _,
  createMemoryCacheStore,
  createMultiBackend,
  parseConfig,
  withoutDisabled,
  type AccountConfig,
  type CalendarBackend,
  type ReminderConfig,
  type SecretStore,
} from '@reminder/core';

import type { Context } from '../context.ts';
import { DEMO_ACCOUNTS, DEMO_LISTS, demoCalendars, demoReminders } from './fixtures.ts';
import { createMemoryBackend } from './memory-backend.ts';

export { DEMO_ACCOUNTS, DEMO_LISTS } from './fixtures.ts';

/** The demo flag is an environment variable, so `--demo` and the CLI commands share one switch. */
export function demoActive(env: Record<string, string | undefined> = process.env): boolean {
  return env.REMINDER_DEMO === '1';
}

/** What the window says about itself while it shows invented data. */
export const demoNotice = (): string => _('Demo mode — invented data, nothing is saved.');

export function demoConfig(): ReminderConfig {
  return parseConfig({
    accounts: DEMO_ACCOUNTS.map((a) => ({ id: a.id, backend: 'eds' })),
    grants: DEMO_LISTS.filter((l) => !l.readOnly).flatMap((l) =>
      (['reminder.create', 'reminder.update'] as const).map((capability) => ({
        capability,
        target: `${l.account}:${l.uid}`,
      })),
    ),
  });
}

const noSecrets: SecretStore = {
  id: 'demo',
  lookup: async () => {
    throw new Error('demo mode has no secret store');
  },
  store: async () => ({ status: 'unavailable', reason: 'demo mode has no secret store' }),
  clear: async () => ({ status: 'unavailable', reason: 'demo mode has no secret store' }),
};

/** `config` lets the preferences carry their in-memory edits into a rebuilt context. */
export function createDemoContext(now: Date = new Date(), config: ReminderConfig = demoConfig()): Context {
  const backends = new Map<string, CalendarBackend>(
    DEMO_ACCOUNTS.map((a) => [
      a.id,
      createMemoryBackend(
        'demo',
        demoCalendars(a.id),
        demoReminders(a.id, now),
        new Set(DEMO_LISTS.filter((l) => l.account === a.id && l.readOnly).map((l) => l.uid)),
      ),
    ]),
  );
  const own = (account: AccountConfig): CalendarBackend => {
    const found = backends.get(account.id);
    if (!found) throw new Error(`no demo account ${account.id}`);
    return found;
  };
  const cache = createMemoryCacheStore();
  return {
    config: () => config,
    backend: () =>
      withoutDisabled(
        createMultiBackend(config.accounts.map((a) => ({ id: a.id, backend: own(a) }))),
        config.disabled,
      ),
    cache: () => cache,
    // No demo account names a secret, so this is never asked; if one ever does, it fails loudly.
    secrets: () => noSecrets,
    accountBackend: own,
  };
}
