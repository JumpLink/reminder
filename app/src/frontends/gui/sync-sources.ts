/**
 * Which task lists the sync service keeps fresh: every enabled reminder list of every account,
 * grouped by host so one slow server cannot starve the others (docs/adr/0017).
 */

import { enabledSyncSources, type CalendarInfo, type ReminderConfig, type SyncSource } from '@reminder/core';

export interface AccountLists {
  account: string;
  /** The account's own backend answer: uids are NOT qualified with the account. */
  calendars: readonly CalendarInfo[];
}

function hostOf(config: ReminderConfig, account: string): string {
  const entry = config.accounts.find((a) => a.id === account);
  if (entry?.backend !== 'caldav' || !entry.caldav) return 'local';
  try {
    return new URL(entry.caldav.url).host || account;
  } catch {
    return account;
  }
}

export function buildSyncSources(config: ReminderConfig, lists: readonly AccountLists[]): SyncSource[] {
  const sources: SyncSource[] = [];
  for (const { account, calendars } of lists) {
    const entry = config.accounts.find((a) => a.id === account);
    if (!entry) continue;
    for (const calendar of calendars) {
      if (calendar.kind !== 'reminder') continue;
      sources.push({
        key: { account, source: calendar.uid },
        kind: entry.backend,
        host: hostOf(config, account),
      });
    }
  }
  return enabledSyncSources(config.accounts, config.disabled, sources);
}
