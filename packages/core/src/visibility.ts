/**
 * The "disabled" level of docs/adr/0006: a disabled source is absent — not listed, not queried,
 * not written to, not cached. This is the one place that answers "is this source on"; every
 * frontend gets its backend and its cache through here.
 *
 * Enabled is the default: a calendar the server gains later shows up without a config change.
 * The "hidden" level is GUI state and never reaches the core.
 */

import type { CalendarBackend } from '@gjsify/pim';
import { qualifyTarget, resolveAccountTarget, type AccountRef } from './accounts.ts';
import type { CacheKey, CacheStore } from './cache.ts';
import { guardCache } from './cache.ts';
import { ConfigError, ReminderError } from './errors.ts';
import type { RawItem } from './types.ts';
import { _, fmt } from './i18n.ts';

export function parseDisabled(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ConfigError(_('disabled must be a list of calendar uids'));
  return [
    ...new Set(
      value.map((entry: unknown, index) => {
        if (typeof entry !== 'string' || entry.trim() === '')
          throw new ConfigError(fmt(_('disabled[{index}] must be a non-empty calendar uid'), { index }));
        return entry;
      }),
    ),
  ];
}

/** Exact match, like a grant: the uid as `reminder calendars` prints it. */
export function isSourceEnabled(disabled: readonly string[], target: string): boolean {
  return !disabled.includes(target);
}

/** The target spelling a cache key stands for — qualified only when there is more than one account. */
export function targetOfCacheKey(accounts: readonly AccountRef[], key: CacheKey): string {
  return accounts.length > 1 ? qualifyTarget(key.account, key.source) : key.source;
}

/** The cache key a target is stored under, or null when the target names no account. */
export function cacheKeyOfTarget(accounts: readonly AccountRef[], target: string): CacheKey | null {
  const split = resolveAccountTarget(accounts, target);
  return split === null ? null : { account: split.account, source: split.uid };
}

/** A cache that never holds a disabled source (ADR 0006 §2). */
export function guardDisabledCache(
  inner: CacheStore,
  accounts: readonly AccountRef[],
  disabled: readonly string[],
): CacheStore {
  return guardCache(inner, (key) => isSourceEnabled(disabled, targetOfCacheKey(accounts, key)));
}

/**
 * Turn a source on or off, returning the new list. Turning it off also removes what the cache
 * holds for it, so "off" means nothing of it is stored here; repeating either is harmless.
 */
export async function setSourceEnabled(
  accounts: readonly AccountRef[],
  disabled: readonly string[],
  target: string,
  enabled: boolean,
  cache?: CacheStore,
): Promise<string[]> {
  if (enabled) return disabled.filter((t) => t !== target);
  const key = cacheKeyOfTarget(accounts, target);
  if (cache && key) await cache.delete(key);
  return disabled.includes(target) ? [...disabled] : [...disabled, target];
}

/**
 * The backend as every frontend sees it: disabled calendars are gone. With nothing disabled it is
 * the inner backend itself, so that path costs nothing.
 *
 * A read over all calendars cannot be handed down as one call — the driver would fetch the
 * disabled ones too — so it becomes one call per enabled calendar.
 */
export function withoutDisabled(inner: CalendarBackend, disabled: readonly string[]): CalendarBackend {
  if (disabled.length === 0) return inner;
  const require = (calendarUid: string): void => {
    if (!isSourceEnabled(disabled, calendarUid))
      throw new ReminderError(fmt(_('calendar "{uid}" is disabled in the configuration'), { uid: calendarUid }));
  };
  return {
    id: inner.id,

    async listCalendars(kind) {
      return (await inner.listCalendars(kind)).filter((c) => isSourceEnabled(disabled, c.uid));
    },

    async listItems(query) {
      if (query.calendarUid !== undefined) {
        require(query.calendarUid);
        return inner.listItems(query);
      }
      const calendars = (await inner.listCalendars(query.kind)).filter((c) => isSourceEnabled(disabled, c.uid));
      const perCalendar = await Promise.all(
        calendars.map((c): Promise<RawItem[]> => inner.listItems({ ...query, calendarUid: c.uid })),
      );
      return perCalendar.flat();
    },

    async getItem(calendarUid, kind, uid) {
      require(calendarUid);
      return inner.getItem(calendarUid, kind, uid);
    },

    async createItem(calendarUid, kind, ical) {
      require(calendarUid);
      return inner.createItem(calendarUid, kind, ical);
    },

    async updateItem(calendarUid, kind, uid, ical, etag) {
      require(calendarUid);
      return inner.updateItem(calendarUid, kind, uid, ical, etag);
    },
  };
}
