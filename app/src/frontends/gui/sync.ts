/**
 * The sync service of the window (docs/adr/0017, 0018): one source per enabled task list, CalDAV
 * through the delta reader, EDS through a plain listing. The password is resolved from the secret
 * store before the reader is built, exactly like the CLI; it is never logged or put in a message.
 */

import { createCaldavDeltaReader } from '@gjsify/pim/caldav';
import {
  createCollectionSyncFetch,
  createSyncService,
  encodeCollectionBody,
  errorMessage,
  withoutDisabled,
  type CalendarBackend,
  type SyncFetch,
  type SyncService,
} from '@reminder/core';

import {
  createAccountBackend,
  createBackend,
  resolveSecretPasswords,
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

export async function createGuiSync(
  context: Context,
  env: Record<string, string | undefined> = process.env,
): Promise<GuiSync> {
  const config = context.config();
  const problems: string[] = [];
  let passwords: ReadonlyMap<string, string> = new Map();
  try {
    passwords = await resolveSecretPasswords(config, context.secrets());
  } catch (err) {
    problems.push(errorMessage(err));
  }

  let backend: CalendarBackend | null = null;
  try {
    backend = withoutDisabled(createBackend(config, env, passwords), config.disabled);
  } catch (err) {
    problems.push(errorMessage(err));
  }

  const named = config.accounts.length > 1;
  const backends = new Map<string, CalendarBackend>();
  const lists: AccountLists[] = [];
  for (const account of config.accounts) {
    try {
      const own = createAccountBackend(account, env, named, passwords);
      backends.set(account.id, own);
      lists.push({ account: account.id, calendars: await own.listCalendars('reminder') });
    } catch (err) {
      problems.push(errorMessage(err));
    }
  }

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
