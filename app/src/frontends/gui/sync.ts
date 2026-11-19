/**
 * The sync service of the window (docs/adr/0017, 0018): one source per enabled task list, CalDAV
 * through the delta reader, EDS through a plain listing. The password is resolved from the secret
 * store before the reader is built, exactly like the CLI; it is never logged or put in a message.
 */

import { createCaldavDeltaReader } from '@gjsify/pim/caldav';
import {
  BackendUnavailableError,
  createCollectionSyncFetch,
  createMultiBackend,
  createSyncService,
  encodeCollectionBody,
  errorMessage,
  withoutDisabled,
  type BackendAccount,
  type CalendarBackend,
  type CalendarInfo,
  type SyncFetch,
  type SyncService,
} from '@reminder/core';

import {
  about,
  createAccountBackend,
  resolveSecretPasswordsPerAccount,
  type Context,
} from '../../core/context.ts';
import { buildSyncSources, type AccountLists } from './sync-sources.ts';

export interface GuiSync {
  service: SyncService;
  /**
   * What the views read and write through: every account, disabled lists cut. Built here and not
   * by `context.backend()`, which has no secrets resolved and would refuse a `passwordSecret`.
   */
  backend: CalendarBackend | null;
  /** One line per account that could not be set up; the rest still syncs. */
  problems: string[];
}

/** Stands in for an account that could not be set up: no lists, and every write says why. */
function unavailableBackend(reason: string): CalendarBackend {
  const refuse = async (): Promise<never> => {
    throw new BackendUnavailableError(reason);
  };
  return {
    id: 'unavailable',
    listCalendars: async () => [],
    listItems: async () => [],
    getItem: refuse,
    createItem: refuse,
    updateItem: refuse,
  };
}

/**
 * Hands out the listing made while setting the account up to the first caller, so the window does
 * not ask the server for its calendars twice at start. Later calls are real.
 */
function primed(backend: CalendarBackend, initial: CalendarInfo[]): CalendarBackend {
  let first: CalendarInfo[] | null = initial;
  return {
    ...backend,
    id: backend.id,
    async listCalendars(kind) {
      if (first) {
        const all = first;
        first = null;
        return kind ? all.filter((c) => c.kind === kind) : all;
      }
      return backend.listCalendars(kind);
    },
    listItems: (query) => backend.listItems(query),
    getItem: (calendarUid, kind, uid) => backend.getItem(calendarUid, kind, uid),
    createItem: (calendarUid, kind, ical) => backend.createItem(calendarUid, kind, ical),
    updateItem: (calendarUid, kind, uid, ical, etag) =>
      backend.updateItem(calendarUid, kind, uid, ical, etag),
  };
}

export async function createGuiSync(
  context: Context,
  env: Record<string, string | undefined> = process.env,
): Promise<GuiSync> {
  const config = context.config();
  const problems: string[] = [];
  let passwords: ReadonlyMap<string, string> = new Map();
  let failures: ReadonlyMap<string, string> = new Map();
  try {
    const resolved = await resolveSecretPasswordsPerAccount(config, context.secrets());
    passwords = resolved.passwords;
    failures = resolved.failures;
  } catch (err) {
    problems.push(errorMessage(err));
  }

  // One broken account does not take the others down (the CLI still fails whole, ADR 0005).
  const named = config.accounts.length > 1;
  const backends = new Map<string, CalendarBackend>();
  const lists: AccountLists[] = [];
  const accounts: BackendAccount[] = [];
  for (const account of config.accounts) {
    // Setup errors already name the account; a listing error does not yet.
    let phase: 'setup' | 'listing' = 'setup';
    try {
      const failure = failures.get(account.id);
      if (failure !== undefined) throw new Error(failure);
      const own = context.accountBackend?.(account) ?? createAccountBackend(account, env, named, passwords);
      phase = 'listing';
      const calendars = await own.listCalendars();
      const ready = primed(own, calendars);
      backends.set(account.id, ready);
      accounts.push({ id: account.id, backend: ready });
      lists.push({ account: account.id, calendars });
    } catch (err) {
      const raw = errorMessage(err);
      const message = phase === 'listing' ? about(raw, account, named) : raw;
      problems.push(message);
      accounts.push({ id: account.id, backend: unavailableBackend(message) });
    }
  }

  // With several accounts the multiplexer stays over ALL of them, so uids keep their prefix; a
  // broken one is an empty stand-in rather than a hole.
  const backend: CalendarBackend | null =
    backends.size === 0
      ? null
      : withoutDisabled(
          accounts.length > 1 ? createMultiBackend(accounts) : accounts[0].backend,
          config.disabled,
        );

  const cache = context.cache();
  const readers = new Map<string, ReturnType<typeof createCaldavDeltaReader>>();
  for (const account of config.accounts) {
    const caldav = account.caldav;
    if (account.backend !== 'caldav' || !caldav || !backends.has(account.id)) continue;
    const password =
      caldav.passwordSecret !== undefined ? passwords.get(account.id) : env[caldav.passwordEnv];
    if (password)
      readers.set(
        account.id,
        createCaldavDeltaReader({ url: caldav.url, username: caldav.username, password }),
      );
  }

  const caldavFetch = createCollectionSyncFetch(cache, (key, previous) => {
    const reader = readers.get(key.account);
    if (!reader) throw new Error('no CalDAV reader for this account');
    return reader.read(key.source, 'reminder', previous);
  });
  const edsFetch: SyncFetch = async (key) => {
    const own = backends.get(key.account);
    if (!own) throw new Error('no backend for this account');
    const raw = await own.listItems({ kind: 'reminder', calendarUid: key.source });
    return {
      kind: 'changed',
      body: encodeCollectionBody(raw.map((r, i) => ({ href: String(i), etag: null, ical: r.ical }))),
      version: null,
    };
  };

  const service = createSyncService({
    cache,
    fetch: (key, previous) =>
      readers.has(key.account) ? caldavFetch(key, previous) : edsFetch(key, previous),
    clock: { now: () => Date.now() },
    scheduler: {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    sources: buildSyncSources(config, lists),
  });
  return { service, backend, problems };
}
