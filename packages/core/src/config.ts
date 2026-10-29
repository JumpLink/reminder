/**
 * The configuration file's model — parsing and validation only; the app owns the path and I/O.
 *
 * Unknown top-level keys are carried through and written back. A build that does not know a key
 * must not erase it on save: curlew learned that an older build dropping `grants` fails closed on
 * read and destructively on write.
 */

import { ConfigError } from './errors.ts';
import { parseGrants, type Grant } from './grants.ts';
import { parseDefaults, parseRoutes, type RoutingConfig } from './routing.ts';

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
}

export interface ReminderConfig extends RoutingConfig {
  backend: BackendId;
  grants: Grant[];
  priorities: PrioritiesConfig;
  /** Present when `backend` is `caldav`. */
  caldav?: CaldavConfig;
  /** Keys this build does not know, kept verbatim. */
  extra: Record<string, unknown>;
}

const KNOWN = new Set(['backend', 'grants', 'routes', 'defaults', 'priorities', 'caldav']);

export function emptyConfig(): ReminderConfig {
  return { backend: 'eds', grants: [], routes: [], defaults: {}, priorities: {}, extra: {} };
}

function parsePriorities(value: unknown): PrioritiesConfig {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ConfigError('priorities must be an object');
  const { list } = value as Record<string, unknown>;
  if (list === undefined) return {};
  if (typeof list !== 'string' || list === '')
    throw new ConfigError('priorities.list must be a non-empty task list uid');
  return { list };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function parseCaldav(value: unknown): CaldavConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ConfigError('backend "caldav" needs a caldav object with url and username');
  const r = value as Record<string, unknown>;
  const text = (key: string): string | undefined => {
    const v = r[key];
    if (v === undefined) return undefined;
    if (typeof v !== 'string' || v === '') throw new ConfigError(`caldav.${key} must be a non-empty string`);
    return v;
  };
  const url = text('url');
  if (!url) throw new ConfigError('caldav.url is required');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError('caldav.url must be an http(s) URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    throw new ConfigError('caldav.url must be an http(s) URL');
  // Basic auth sends the password with every request, so plain http would put it on the wire.
  if (parsed.protocol === 'http:' && !LOOPBACK.has(parsed.hostname))
    throw new ConfigError('caldav.url must use https unless the server is on this machine');
  const auth = r.auth ?? 'basic';
  if (!(CALDAV_AUTH as readonly unknown[]).includes(auth))
    throw new ConfigError(`caldav.auth ${JSON.stringify(auth)} is not supported (known: ${CALDAV_AUTH.join(', ')})`);
  const username = text('username');
  if (auth === 'basic' && !username) throw new ConfigError('caldav.username is required for basic auth');
  if ('password' in r)
    throw new ConfigError('caldav.password must not be in the file — set passwordEnv and export the variable');
  return {
    url,
    auth: auth as CaldavAuth,
    username: username ?? '',
    passwordEnv: text('passwordEnv') ?? DEFAULT_PASSWORD_ENV,
  };
}

export function parseConfig(raw: unknown): ReminderConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new ConfigError('config must be a JSON object');
  const record = raw as Record<string, unknown>;
  const backend = record.backend ?? 'eds';
  if (!(BACKENDS as readonly unknown[]).includes(backend)) {
    throw new ConfigError(
      `backend ${JSON.stringify(backend)} is not supported (known: ${BACKENDS.join(', ')})`,
    );
  }
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) if (!KNOWN.has(key)) extra[key] = value;
  // Another backend's section stays in the file untouched (see the header: never erase on save).
  if (backend !== 'caldav' && record.caldav !== undefined) extra.caldav = record.caldav;
  return {
    backend: backend as BackendId,
    grants: parseGrants(record.grants),
    routes: parseRoutes(record.routes),
    defaults: parseDefaults(record.defaults),
    priorities: parsePriorities(record.priorities),
    ...(backend === 'caldav' ? { caldav: parseCaldav(record.caldav) } : {}),
    extra,
  };
}

export function serializeConfig(config: ReminderConfig): string {
  const { extra, ...known } = config;
  return `${JSON.stringify({ ...extra, ...known }, null, 2)}\n`;
}
