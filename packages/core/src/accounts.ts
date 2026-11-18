/**
 * Several accounts behind one configuration (docs/adr/0005): the account id, the target spelling
 * `<account-id>:<uid>`, and the multiplexer that puts one `CalendarBackend` in front of several.
 *
 * Reads merge across accounts, a write goes to the one account its target names. Nothing below
 * the multiplexer learns that accounts exist, and nothing above it learns that backends do.
 */

import type { CalendarBackend } from '@gjsify/pim';
import { ConfigError, ReminderError } from './errors.ts';
import type { CalendarInfo, RawItem } from './types.ts';
import { _, fmt } from './i18n.ts';

/** What an unnamed, single-account configuration is called. A legal id like any other. */
export const DEFAULT_ACCOUNT_ID = 'default';

/** Lowercase, no colon, no slash, no dot — the prefix has to be decidable at the first colon. */
const ACCOUNT_ID = /^[a-z0-9][a-z0-9_-]*$/;
const ACCOUNT_ID_MAX = 32;
/** A CalDAV uid is a URL: these two ids would make a bare one read as a qualified target. */
const RESERVED_IDS = new Set(['http', 'https']);

/** What target resolution needs from an account — its id, nothing else. */
export interface AccountRef {
  readonly id: string;
}

export function parseAccountId(value: unknown, index: number): string {
  if (typeof value !== 'string' || value === '')
    throw new ConfigError(fmt(_('accounts[{index}]: id must be a non-empty string'), { index }));
  if (value.length > ACCOUNT_ID_MAX) {
    throw new ConfigError(
      fmt(_('accounts[{index}]: id must be at most {max} characters'), { index, max: ACCOUNT_ID_MAX }),
    );
  }
  if (!ACCOUNT_ID.test(value)) {
    throw new ConfigError(
      fmt(_('accounts[{index}]: id "{id}" must start with a lowercase letter or digit and hold only those, "-" and "_"'), {
        index,
        id: value,
      }),
    );
  }
  if (RESERVED_IDS.has(value)) {
    throw new ConfigError(
      fmt(_('accounts[{index}]: id "{id}" is reserved — it would read as a URL scheme'), { index, id: value }),
    );
  }
  return value;
}

export interface QualifiedTarget {
  account: string;
  /** The uid as the account's backend knows it, without the prefix. */
  uid: string;
}

/** `<account>:<uid>` from its parts. The one place a qualified target is built. */
export function qualifyTarget(account: string, uid: string): string {
  return `${account}:${uid}`;
}

/**
 * Split at the FIRST colon, never the last: a CalDAV uid is a collection URL and carries colons
 * of its own, so everything behind the first one is the uid verbatim.
 *
 * Null when the head is not a legal account id — `http://dav.example.org/` splits mechanically,
 * which is why `http` and `https` are reserved rather than parsed around.
 */
export function splitTarget(target: string): QualifiedTarget | null {
  const colon = target.indexOf(':');
  if (colon <= 0) return null;
  const account = target.slice(0, colon);
  const uid = target.slice(colon + 1);
  if (uid === '' || account.length > ACCOUNT_ID_MAX || !ACCOUNT_ID.test(account)) return null;
  return { account, uid };
}

/**
 * The account and bare uid a target names, or null when it names none.
 *
 * With exactly one account the target is NOT split: a bare CalDAV URL stays whole without any
 * rule about what its scheme looks like.
 */
export function resolveAccountTarget(
  accounts: readonly AccountRef[],
  target: string,
): QualifiedTarget | null {
  if (accounts.length === 0) return null;
  if (accounts.length === 1) return { account: accounts[0].id, uid: target };
  const split = splitTarget(target);
  if (!split || !accounts.some((a) => a.id === split.account)) return null;
  return split;
}

/**
 * Every grant, route, default and `priorities.list` must name a configured account once there is
 * more than one. Raised at load with the full list, not per call: adding a second account is the
 * moment those targets become ambiguous, and silently resolving them against the first would put
 * a write on a server nobody named.
 */
export function checkAccountTargets(accounts: readonly AccountRef[], targets: readonly string[]): void {
  if (accounts.length <= 1) return;
  const bad = [...new Set(targets)].filter((t) => resolveAccountTarget(accounts, t) === null);
  if (bad.length === 0) return;
  throw new ConfigError(
    fmt(
      _('with several accounts every target must read "<account>:<uid>" (accounts: {accounts}) — these do not: {targets}'),
      { accounts: accounts.map((a) => a.id).join(', '), targets: bad.join(', ') },
    ),
  );
}

/** One account's backend, ready to serve. */
export interface BackendAccount extends AccountRef {
  backend: CalendarBackend;
}

/**
 * One backend over several accounts: reads merge, writes go to the account the target names.
 *
 * Every uid that leaves here is qualified, so the comparisons above it — "is this calendar
 * enabled", "does a grant name it", "is this the priorities list" — hold both sides in the same
 * spelling. Use it only for more than one account; a single account needs no prefix at all.
 */
export function createMultiBackend(accounts: readonly BackendAccount[]): CalendarBackend {
  const pick = (target: string): { account: BackendAccount; uid: string } => {
    const split = resolveAccountTarget(accounts, target);
    const account = split === null ? undefined : accounts.find((a) => a.id === split.account);
    if (split === null || account === undefined) {
      throw new ReminderError(
        fmt(_('"{target}" names no account — take a uid from `reminder calendars` (accounts: {accounts})'), {
          target,
          accounts: accounts.map((a) => a.id).join(', '),
        }),
      );
    }
    return { account, uid: split.uid };
  };

  return {
    id: 'multi',

    async listCalendars(kind) {
      const perAccount = await Promise.all(
        accounts.map(async (a): Promise<CalendarInfo[]> =>
          (await a.backend.listCalendars(kind)).map((c) => ({ ...c, uid: qualifyTarget(a.id, c.uid) })),
        ),
      );
      return perAccount.flat();
    },

    async listItems(query) {
      const qualified = (a: BackendAccount, items: RawItem[]): RawItem[] =>
        items.map((item) => ({ ...item, calendarUid: qualifyTarget(a.id, item.calendarUid) }));
      if (query.calendarUid !== undefined) {
        const { account, uid } = pick(query.calendarUid);
        return qualified(account, await account.backend.listItems({ ...query, calendarUid: uid }));
      }
      const perAccount = await Promise.all(
        accounts.map(async (a) => qualified(a, await a.backend.listItems(query))),
      );
      return perAccount.flat();
    },

    async getItem(calendarUid, kind, uid) {
      const { account, uid: bare } = pick(calendarUid);
      return account.backend.getItem(bare, kind, uid);
    },

    async createItem(calendarUid, kind, ical) {
      const { account, uid: bare } = pick(calendarUid);
      return account.backend.createItem(bare, kind, ical);
    },

    async updateItem(calendarUid, kind, uid, ical, etag) {
      const { account, uid: bare } = pick(calendarUid);
      return account.backend.updateItem(bare, kind, uid, ical, etag);
    },
  };
}
