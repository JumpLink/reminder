/**
 * The configuration file's model — parsing and validation only; the app owns the path and I/O.
 *
 * Unknown top-level keys are carried through and written back. A build that does not know a key
 * must not erase it on save: curlew learned that an older build dropping `grants` fails closed on
 * read and destructively on write. The same holds for keys inside an account.
 *
 * Two spellings, one model (docs/adr/0005). A file with `accounts` names them; a file without is
 * read as ONE account, `default`, taking the top-level `backend` and `caldav` as they are written.
 * The spelling a file was read in is the spelling it is written back in: there is no version
 * number, no migration and no rewrite on save.
 */

import {
  checkAccountTargets,
  DEFAULT_ACCOUNT_ID,
  parseAccountId,
  type AccountRef,
} from './accounts.ts';
import { ConfigError } from './errors.ts';
import { parseSecretRef } from './secrets.ts';
import { parseDisabled } from './visibility.ts';
import { parseGrants, type Grant } from './grants.ts';
import { parseDefaults, parseRoutes, type RoutingConfig } from './routing.ts';
import { emptyBoardsConfig, parseBoards, serializeBoards, type BoardsConfig } from './board/config.ts';
import {
  parseExternalSources,
  serializeExternalSource,
  type ExternalSourceConfig,
} from './board/sources-config.ts';
import { _, fmt } from './i18n.ts';

export const BACKENDS = ['eds', 'caldav'] as const;
export type BackendId = (typeof BACKENDS)[number];

/** Where priorities live (docs/adr/0002). No default: an arbitrary list would rank arbitrary tasks. */
export interface PrioritiesConfig {
  /** Task list uid, like a route target. */
  list?: string;
}

export const CALDAV_AUTH = ['basic', 'oauth2'] as const;
export type CaldavAuth = (typeof CALDAV_AUTH)[number];

/** Environment variable holding the password when `passwordEnv` is not set. */
export const DEFAULT_PASSWORD_ENV = 'REMINDER_CALDAV_PASSWORD';

/**
 * The CalDAV server. The password is never in the file: `passwordEnv` names the environment
 * variable that carries it. `oauth2` parses (so a config can be written ahead) but the backend
 * refuses it with UnsupportedAuthError until that phase lands.
 */
export interface CaldavConfig {
  /** Server root or any URL the user knows; discovery (RFC 6764) finds the rest. */
  url: string;
  auth: CaldavAuth;
  /** Required for `basic`. */
  username: string;
  passwordEnv: string;
  /**
   * `<account>:<purpose>` — the password lives in a SecretStore (docs/adr/0011) instead of an
   * environment variable. Naming both `passwordEnv` and `passwordSecret` is a ConfigError.
   */
  passwordSecret?: string;
}

/** One place calendars come from: an id the person chose plus what its backend needs. */
export interface AccountConfig extends AccountRef {
  id: string;
  backend: BackendId;
  /** Present when `backend` is `caldav`. Two CalDAV accounts carry two URLs and two variables. */
  caldav?: CaldavConfig;
  /** Keys this build does not know, kept verbatim. */
  extra: Record<string, unknown>;
}

export interface ReminderConfig extends RoutingConfig {
  /** Every configured account, in file order. Never empty. */
  accounts: AccountConfig[];
  /**
   * The one-account spelling, present only for a file written without `accounts` — and the marker
   * that says so. Undefined means the file names its accounts, and asking "which backend" has no
   * answer: read `accounts`.
   */
  backend?: BackendId;
  /** The one-account spelling's CalDAV section; see `backend`. */
  caldav?: CaldavConfig;
  grants: Grant[];
  priorities: PrioritiesConfig;
  /** Lanes and "mine" per board (docs/adr/0008); empty until a person configures one. */
  boards: BoardsConfig;
  /** Deck, OpenProject and Zenkit sources (docs/adr/0007); the credential is a secret reference. */
  boardSources: ExternalSourceConfig[];
  /**
   * Calendar and task-list uids that are off (docs/adr/0006): not listed, queried, written or
   * cached. Same spelling as a grant target. Everything not named here is enabled.
   */
  disabled: string[];
  /** Keys this build does not know, kept verbatim. */
  extra: Record<string, unknown>;
}

const KNOWN = new Set([
  'accounts',
  'backend',
  'grants',
  'routes',
  'defaults',
  'priorities',
  'caldav',
  'disabled',
  'boards',
  'boardSources',
]);
const ACCOUNT_KNOWN = new Set(['id', 'backend', 'caldav']);

export function emptyConfig(): ReminderConfig {
  return {
    accounts: [{ id: DEFAULT_ACCOUNT_ID, backend: 'eds', extra: {} }],
    backend: 'eds',
    grants: [],
    routes: [],
    defaults: {},
    priorities: {},
    boards: emptyBoardsConfig(),
    boardSources: [],
    disabled: [],
    extra: {},
  };
}

/**
 * `index` names the account the value came from; without one the file has no `accounts` and the
 * message is the one a v1 config always got. Two whole msgids rather than a translated fragment
 * glued onto a translated sentence: only the whole sentence can be reordered by a translator.
 */
function parseBackendId(value: unknown, index?: number): BackendId {
  if (!(BACKENDS as readonly unknown[]).includes(value)) {
    const backend = JSON.stringify(value);
    const known = BACKENDS.join(', ');
    throw new ConfigError(
      index === undefined
        ? fmt(_('backend {backend} is not supported (known: {known})'), { backend, known })
        : fmt(_('accounts[{index}]: backend {backend} is not supported (known: {known})'), {
            index,
            backend,
            known,
          }),
    );
  }
  return value as BackendId;
}

function parsePriorities(value: unknown): PrioritiesConfig {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ConfigError(_('priorities must be an object'));
  const { list } = value as Record<string, unknown>;
  if (list === undefined) return {};
  if (typeof list !== 'string' || list === '')
    throw new ConfigError(_('priorities.list must be a non-empty task list uid'));
  return { list };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseCaldav(value: unknown): CaldavConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ConfigError(_('backend "caldav" needs a caldav object with url and username'));
  const r = value as Record<string, unknown>;
  const text = (key: string): string | undefined => {
    const v = r[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'string' || v === '') throw new ConfigError(fmt(_('caldav.{key} must be a non-empty string'), { key }));
    return v;
  };
  const url = text('url');
  if (!url) throw new ConfigError(_('caldav.url is required'));
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError(_('caldav.url must be an http(s) URL'));
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    throw new ConfigError(_('caldav.url must be an http(s) URL'));
  // Basic auth sends the password with every request, so plain http would put it on the wire.
  if (parsed.protocol === 'http:' && !LOOPBACK.has(parsed.hostname))
    throw new ConfigError(_('caldav.url must use https unless the server is on this machine'));
  const auth = r.auth ?? 'basic';
  if (!(CALDAV_AUTH as readonly unknown[]).includes(auth))
    throw new ConfigError(
      fmt(_('caldav.auth {auth} is not supported (known: {known})'), {
        auth: JSON.stringify(auth),
        known: CALDAV_AUTH.join(', '),
      }),
    );
  const username = text('username');
  if (auth === 'basic' && !username) throw new ConfigError(_('caldav.username is required for basic auth'));
  if ('password' in r)
    throw new ConfigError(_('caldav.password must not be in the file — set passwordEnv and export the variable'));
  const passwordSecret = text('passwordSecret');
  if (passwordSecret !== undefined) {
    if (r.passwordEnv !== undefined) throw new ConfigError(_('caldav: set passwordEnv or passwordSecret, not both'));
    parseSecretRef(passwordSecret);
  }
  return {
    url,
    auth: auth as CaldavAuth,
    username: username ?? '',
    passwordEnv: text('passwordEnv') ?? DEFAULT_PASSWORD_ENV,
    ...(passwordSecret !== undefined ? { passwordSecret } : {}),
  };
}

function parseAccounts(value: unknown): AccountConfig[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new ConfigError(_('accounts must be a list with at least one account'));
  const seen = new Set<string>();
  return value.map((entry: unknown, index): AccountConfig => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new ConfigError(fmt(_('accounts[{index}] must be an object'), { index }));
    const record = entry as Record<string, unknown>;
    const id = parseAccountId(record.id, index);
    if (seen.has(id)) throw new ConfigError(fmt(_('accounts[{index}]: id "{id}" is used twice'), { index, id }));
    seen.add(id);
    const backend = parseBackendId(record.backend ?? 'eds', index);
    const extra: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(record)) if (!ACCOUNT_KNOWN.has(key)) extra[key] = v;
    // Another backend's section stays in the file untouched (see the header: never erase on save).
    if (backend !== 'caldav' && record.caldav !== undefined) extra.caldav = record.caldav;
    return { id, backend, ...(backend === 'caldav' ? { caldav: parseCaldav(record.caldav) } : {}), extra };
  });
}

/** Everything in the file that names a calendar: what §2 of docs/adr/0005 asks to be qualified. */
function targetsOf(config: ReminderConfig): string[] {
  return [
    ...config.grants.map((g) => g.target),
    ...config.routes.map((r) => r.target),
    ...Object.values(config.defaults),
    ...(config.priorities.list ? [config.priorities.list] : []),
    ...config.disabled,
  ];
}

export function parseConfig(raw: unknown): ReminderConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new ConfigError(_('config must be a JSON object'));
  const record = raw as Record<string, unknown>;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) if (!KNOWN.has(key)) extra[key] = value;

  let shape: Pick<ReminderConfig, 'accounts' | 'backend' | 'caldav'>;
  if (record.accounts === undefined) {
    const backend = parseBackendId(record.backend ?? 'eds');
    const caldav = backend === 'caldav' ? parseCaldav(record.caldav) : undefined;
    // Another backend's section stays in the file untouched (see the header: never erase on save).
    if (backend !== 'caldav' && record.caldav !== undefined) extra.caldav = record.caldav;
    shape = {
      accounts: [{ id: DEFAULT_ACCOUNT_ID, backend, ...(caldav ? { caldav } : {}), extra: {} }],
      backend,
      ...(caldav ? { caldav } : {}),
    };
  } else {
    // Guessing which of the two spellings wins is how a write lands on the wrong server.
    for (const key of ['backend', 'caldav']) {
      if (record[key] !== undefined)
        throw new ConfigError(fmt(_('a file with accounts must not also have a top-level {key}'), { key }));
    }
    shape = { accounts: parseAccounts(record.accounts) };
  }

  const config: ReminderConfig = {
    ...shape,
    grants: parseGrants(record.grants),
    routes: parseRoutes(record.routes),
    defaults: parseDefaults(record.defaults),
    priorities: parsePriorities(record.priorities),
    boards: parseBoards(record.boards),
    boardSources: parseExternalSources(
      record.boardSources,
      shape.accounts.map((a) => a.id),
    ),
    disabled: parseDisabled(record.disabled),
    extra,
  };
  checkAccountTargets(config.accounts, targetsOf(config));
  return config;
}

/** With a secret reference the default `passwordEnv` is not written, or the file would name both. */
function serializeCaldav(caldav: CaldavConfig): Record<string, unknown> {
  if (caldav.passwordSecret === undefined) return { ...caldav };
  const { passwordEnv: _env, ...rest } = caldav;
  return rest;
}

function serializeAccount(account: AccountConfig): Record<string, unknown> {
  const { extra, id, backend, caldav } = account;
  return { ...extra, id, backend, ...(caldav ? { caldav: serializeCaldav(caldav) } : {}) };
}

export function serializeConfig(config: ReminderConfig): string {
  const { extra, accounts, backend, caldav, disabled, boards, boardSources, ...rest } = config;
  // Written back in the spelling it was read in: `backend` present means the file had no accounts.
  const shape =
    backend === undefined
      ? { accounts: accounts.map(serializeAccount) }
      : { backend, ...(caldav ? { caldav: serializeCaldav(caldav) } : {}) };
  // An empty list is not written: a file that never disabled anything stays as it was.
  const off = disabled.length > 0 ? { disabled } : {};
  // Same for the board section: nothing configured means nothing written.
  const configured = serializeBoards(boards);
  const board = configured ? { boards: configured } : {};
  const external = boardSources.length > 0 ? { boardSources: boardSources.map(serializeExternalSource) } : {};
  return `${JSON.stringify({ ...extra, ...shape, ...rest, ...off, ...board, ...external }, null, 2)}\n`;
}
