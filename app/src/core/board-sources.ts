/**
 * Which boards this configuration has (docs/adr/0007 §2).
 *
 * One place turns configuration into `BoardSource`s, so the GUI, the CLI and the MCP server see
 * the same boards. A new source type is ONE entry in {@link BOARD_SOURCE_FACTORIES} plus one in
 * {@link BOARD_TYPE_OF_BACKEND}: nothing else in the app learns that Deck or OpenProject exist,
 * and nothing above here builds a source by hand.
 *
 * Disabled sources (ADR 0006) never load — the backend a factory is handed is wrapped in
 * `withoutDisabled`, so a disabled task list is not among the boards at all. "Hidden" is not here:
 * that is a filter the GUI paints with, and the core never sees it (ADR 0006 §3).
 */

import { createDeckBoardSource } from '@reminder/deck';
import { apiKeyAuth, createOpenProjectSource } from '@reminder/openproject';
import { createZenkitBoardSource } from '@reminder/zenkit';
import {
  cacheKeyOfTarget,
  createVtodoBoardSource,
  errorMessage,
  fmt,
  withoutDisabled,
  _,
  type AccountConfig,
  type BackendId,
  type BoardSource,
  type BoardSourceType,
  type CalendarBackend,
  type CalendarInfo,
  type ExternalSourceConfig,
  type ExternalSourceType,
  type ReminderConfig,
  type SourceInfo,
  type SyncSourceKind,
  type VtodoBoardOptions,
} from '@reminder/core';

/** Who "me" is where the source has no identity to ask — see `VtodoBoardOptions.identity`. */
export type BoardIdentity = NonNullable<VtodoBoardOptions['identity']>;

/** What a factory needs that only the frontend can build: the account's backend and the identity. */
export interface BoardSourceDeps {
  config: ReminderConfig;
  /**
   * One account's OWN backend — uids are not account-qualified, exactly as the account's server
   * reports them. Null when the account could not be set up; it then contributes no board.
   */
  backend(account: AccountConfig): CalendarBackend | null;
  /**
   * The calendars this account was already listed with, where the caller has them. Null asks the
   * backend itself.
   */
  calendars?(account: AccountConfig): readonly CalendarInfo[] | null;
  identity?: BoardIdentity;
  /** Build sources that implement `writeCard` where the adapter can (ADR 0013); the grant is still checked above. */
  writable?: boolean;
  /**
   * The resolved credential of each external source, by source id. A source whose secret could not
   * be read is absent and becomes a problem line, never a request without credentials.
   */
  externalSecrets?: ReadonlyMap<string, string>;
  /** Injected for tests; the adapters default to the global fetch. */
  fetch?: typeof fetch;
}

/**
 * The listing the caller already has, instead of a second request for the same answer: the vtodo
 * source asks `listCalendars` on every board read, and the window listed them once at startup to
 * build its sync sources (`sync-sources.ts`). The boards are then exactly the lists that one
 * listing found — one snapshot of the account, not two.
 */
export function withKnownCalendars(
  inner: CalendarBackend,
  calendars: readonly CalendarInfo[],
): CalendarBackend {
  return {
    id: inner.id,
    async listCalendars(kind) {
      return calendars.filter((c) => kind === undefined || c.kind === kind).map((c) => ({ ...c }));
    },
    listItems: (query) => inner.listItems(query),
    getItem: (calendarUid, kind, uid) => inner.getItem(calendarUid, kind, uid),
    createItem: (calendarUid, kind, ical) => inner.createItem(calendarUid, kind, ical),
    updateItem: (calendarUid, kind, uid, ical, etag) => inner.updateItem(calendarUid, kind, uid, ical, etag),
  };
}

/** A source over one account, or null when this account cannot serve one right now. */
export type BoardSourceFactory = (account: AccountConfig, deps: BoardSourceDeps) => BoardSource | null;

/** Which port an account's backend reaches the board through. Both calendar backends are VTODO. */
export const BOARD_TYPE_OF_BACKEND: Readonly<Record<BackendId, BoardSourceType>> = {
  eds: 'vtodo',
  caldav: 'vtodo',
  vdir: 'vtodo',
};

/**
 * The extension point. Partial on purpose: a type with no factory in THIS build is a problem the
 * caller can report, not a crash and not a silently missing board. Deck, OpenProject and Zenkit
 * each add their entry when their package lands.
 */
export const BOARD_SOURCE_FACTORIES: Readonly<Partial<Record<BoardSourceType, BoardSourceFactory>>> = {
  vtodo: (account, deps) => {
    const own = deps.backend(account);
    if (own === null) return null;
    const known = deps.calendars?.(account) ?? null;
    const base = known === null ? own : withKnownCalendars(own, known);
    return createVtodoBoardSource(withoutDisabled(base, disabledIn(deps.config, account.id)), {
      id: account.id,
      identity: deps.identity,
      writable: deps.writable,
    });
  },
};

/** A source over one external (Deck, OpenProject, Zenkit) entry; throws `ConfigError` when it cannot. */
export type ExternalSourceFactory = (
  source: ExternalSourceConfig,
  secret: string,
  deps: Pick<BoardSourceDeps, 'fetch'>,
) => BoardSource;

/** Only the allowlisted boards (ids) are offered; absent = all. Zenkit does this itself (`onlyLists`). */
export function onlyBoards(inner: BoardSource, allowed: readonly string[] | undefined): BoardSource {
  if (allowed === undefined) return inner;
  return {
    describe: () => inner.describe(),
    whoAmI: () => inner.whoAmI(),
    async listBoards() {
      return (await inner.listBoards()).filter((board) => allowed.includes(board.id));
    },
    listColumns: (board) => inner.listColumns(board),
    listCards: (board, query, since) => inner.listCards(board, query, since),
  };
}

export const EXTERNAL_SOURCE_FACTORIES: Readonly<Record<ExternalSourceType, ExternalSourceFactory>> = {
  deck: (source, secret, deps) =>
    onlyBoards(
      createDeckBoardSource({
        id: source.id,
        baseUrl: source.url ?? '',
        auth: { type: 'app-password', username: source.username ?? '', password: secret },
        fetch: deps.fetch,
      }),
      source.boards,
    ),
  openproject: (source, secret, deps) =>
    onlyBoards(
      createOpenProjectSource({
        id: source.id,
        baseUrl: source.url ?? '',
        auth: apiKeyAuth(secret),
        fetch: deps.fetch,
      }),
      source.boards,
    ),
  zenkit: (source, secret, deps) =>
    createZenkitBoardSource({
      id: source.id,
      apiKey: secret,
      ...(source.url !== undefined ? { baseUrl: source.url } : {}),
      ...(source.lists ? { lists: source.lists } : {}),
      ...(source.boards ? { onlyLists: source.boards } : {}),
      ...(deps.fetch ? { http: { fetch: deps.fetch } } : {}),
    }),
};

/** The server a source lives on, for the per-host cap. */
export function externalHost(source: ExternalSourceConfig): string {
  try {
    return new URL(source.url ?? 'https://zenkit.com').host;
  } catch {
    return source.id;
  }
}

/**
 * The disabled targets of one account, spelled the way that account's own backend spells its uids:
 * `disabled` carries targets (qualified only with several accounts, ADR 0005), a per-account
 * backend sees bare uids. Resolved with the same resolver the cache keys use, so one spelling rule
 * holds everywhere.
 */
export function disabledIn(config: ReminderConfig, account: string): string[] {
  const out: string[] = [];
  for (const target of config.disabled) {
    const key = cacheKeyOfTarget(config.accounts, target);
    if (key?.account === account) out.push(key.source);
  }
  return out;
}

/** A source ready to be scheduled: what it is, and where its traffic goes (ADR 0017 §3). */
export interface BoardSourceEntry {
  source: BoardSource;
  info: SourceInfo;
  /** The interval and the per-host cap are chosen by this (`SYNC_INTERVAL_MS`). */
  kind: SyncSourceKind;
  /** The server this source lives on; the concurrency cap counts per host. */
  host: string;
}

export interface BoardSourceSet {
  sources: BoardSourceEntry[];
  /** One line per account whose board could not be built; the other boards still load. */
  problems: string[];
}

/**
 * Every board source the configuration names, in account order. An account that cannot serve one
 * is a line in `problems` — a board view with three of four sources is worth more than none.
 */
export function createBoardSources(
  deps: BoardSourceDeps,
  options: {
    host?: (account: AccountConfig) => string;
    factories?: Readonly<Partial<Record<BoardSourceType, BoardSourceFactory>>>;
  } = {},
): BoardSourceSet {
  const factories = options.factories ?? BOARD_SOURCE_FACTORIES;
  const sources: BoardSourceEntry[] = [];
  const problems: string[] = [];
  for (const account of deps.config.accounts) {
    const type = BOARD_TYPE_OF_BACKEND[account.backend];
    const factory = factories[type];
    if (factory === undefined) {
      problems.push(fmt(_('this build has no board support for "{type}"'), { type }));
      continue;
    }
    const source = factory(account, deps);
    if (source === null) continue;
    sources.push({
      source,
      info: source.describe(),
      kind: account.backend,
      host: options.host?.(account) ?? 'local',
    });
  }
  for (const external of deps.config.boardSources) {
    // Disabled (ADR 0006) means never constructed: no object, no request, no cache.
    if (!external.enabled) continue;
    const secret = deps.externalSecrets?.get(external.id);
    if (!secret) {
      problems.push(
        fmt(_('source "{id}": no credential — store it as {ref}'), { id: external.id, ref: external.secret }),
      );
      continue;
    }
    try {
      const source = EXTERNAL_SOURCE_FACTORIES[external.type](external, secret, deps);
      sources.push({ source, info: source.describe(), kind: external.type, host: externalHost(external) });
    } catch (err) {
      problems.push(fmt(_('source "{id}": {message}'), { id: external.id, message: errorMessage(err) }));
    }
  }
  return { sources, problems };
}
