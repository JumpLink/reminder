/**
 * The external board sources of the configuration file: Nextcloud Deck, OpenProject, Zenkit.
 *
 * ```jsonc
 * "boardSources": [
 *   { "id": "cloud", "type": "deck", "url": "https://cloud.example.org/", "username": "alice",
 *     "secret": "cloud:password", "boards": ["10"] },
 *   { "id": "projects", "type": "openproject", "url": "https://projects.example.org/",
 *     "secret": "projects:token", "enabled": false },
 *   { "id": "zen", "type": "zenkit", "secret": "zen:token",
 *     "lists": { "abc": { "columnField": "Status", "personField": "Owner" } } }
 * ]
 * ```
 *
 * The credential is NEVER in the file: `secret` is a `<id>:<purpose>` reference into the
 * SecretStore (docs/adr/0011), exactly like `caldav.passwordSecret`. A source with
 * `"enabled": false` is disabled in the sense of docs/adr/0006: it is never constructed.
 *
 * A source id shares the namespace of the account ids, because both name the `account` half of a
 * cache key. Keys this build does not know ride along in `extra`.
 */

import { parseAccountId } from '../accounts.ts';
import { ConfigError } from '../errors.ts';
import { _, fmt } from '../i18n.ts';
import { parseSecretRef } from '../secrets.ts';

export const EXTERNAL_SOURCE_TYPES = ['deck', 'openproject', 'zenkit'] as const;
export type ExternalSourceType = (typeof EXTERNAL_SOURCE_TYPES)[number];

/** Which fields of one Zenkit list play which role; selectors are a uuid, id, shortId or name. */
export interface ZenkitListSetting {
  columnField?: string;
  personField?: string;
  labelField?: string | false;
  dueField?: string | false;
}

export interface ExternalSourceConfig {
  id: string;
  type: ExternalSourceType;
  /** The server root. Required for Deck and OpenProject; Zenkit defaults to its hosted API. */
  url?: string;
  /** Deck only: the login the app password belongs to. */
  username?: string;
  /** `<account>:<purpose>` into the SecretStore. */
  secret: string;
  /** False = disabled (docs/adr/0006): never constructed, nothing fetched or cached. */
  enabled: boolean;
  /** Only these boards are offered (a board or list id); absent = every board the login can open. */
  boards?: string[];
  /** Zenkit only, by list id. */
  lists?: Record<string, ZenkitListSetting>;
  /** Keys this build does not know, kept verbatim. */
  extra: Record<string, unknown>;
}

const KNOWN = new Set(['id', 'type', 'url', 'username', 'secret', 'enabled', 'boards', 'lists']);
const SECRET_KEYS = ['password', 'token', 'apiKey', 'apikey', 'api_key'];
const LIST_KEYS = ['columnField', 'personField', 'labelField', 'dueField'] as const;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** The purpose half of the default secret reference. */
export const secretPurposeOf = (type: ExternalSourceType): string => (type === 'deck' ? 'password' : 'token');

function record(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ConfigError(fmt(_('{where} must be an object'), { where }));
  return value as Record<string, unknown>;
}

function text(r: Record<string, unknown>, key: string, where: string): string | undefined {
  const v = r[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || v.trim() === '')
    throw new ConfigError(fmt(_('{where}.{key} must be a non-empty string'), { where, key }));
  return v;
}

/** An http(s) URL; plain http only for a server on this machine, as for CalDAV. */
export function checkSourceUrl(url: string, where: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ConfigError(fmt(_('{where}.url must be an http(s) URL'), { where }));
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
    throw new ConfigError(fmt(_('{where}.url must be an http(s) URL'), { where }));
  if (parsed.protocol === 'http:' && !LOOPBACK.has(parsed.hostname))
    throw new ConfigError(fmt(_('{where}.url must use https unless the server is on this machine'), { where }));
  if (parsed.username !== '' || parsed.password !== '')
    throw new ConfigError(fmt(_('{where}.url must not contain credentials'), { where }));
}

function parseLists(value: unknown, where: string): Record<string, ZenkitListSetting> {
  const out: Record<string, ZenkitListSetting> = {};
  for (const [list, entry] of Object.entries(record(value, `${where}.lists`))) {
    const r = record(entry, `${where}.lists.${list}`);
    for (const key of Object.keys(r)) {
      if (!(LIST_KEYS as readonly string[]).includes(key))
        throw new ConfigError(fmt(_('{where}.lists.{list}: unknown key "{key}"'), { where, list, key }));
    }
    const setting: ZenkitListSetting = {};
    for (const key of LIST_KEYS) {
      const v = r[key];
      if (v === undefined) continue;
      const ok = typeof v === 'string' ? v.trim() !== '' : (key === 'labelField' || key === 'dueField') && v === false;
      if (!ok) throw new ConfigError(fmt(_('{where}.lists.{list}.{key} must be a field name'), { where, list, key }));
      (setting as Record<string, unknown>)[key] = v;
    }
    out[list] = setting;
  }
  return out;
}

function parseOne(entry: unknown, index: number): ExternalSourceConfig {
  const where = `boardSources[${index}]`;
  const r = record(entry, where);
  for (const key of SECRET_KEYS) {
    if (key in r)
      throw new ConfigError(
        fmt(_('{where}.{key} must not be in the file — store it in the keyring and name it with "secret"'), {
          where,
          key,
        }),
      );
  }
  let id: string;
  try {
    id = parseAccountId(r.id, index);
  } catch {
    throw new ConfigError(
      fmt(_('{where}: id must be lowercase letters, digits, "-" and "_", and not "http" or "https"'), { where }),
    );
  }
  const type = r.type;
  if (!(EXTERNAL_SOURCE_TYPES as readonly unknown[]).includes(type))
    throw new ConfigError(
      fmt(_('{where}: type {type} is not supported (known: {known})'), {
        where,
        type: JSON.stringify(type),
        known: EXTERNAL_SOURCE_TYPES.join(', '),
      }),
    );
  const kind = type as ExternalSourceType;
  const url = text(r, 'url', where);
  if (url !== undefined) checkSourceUrl(url, where);
  else if (kind !== 'zenkit') throw new ConfigError(fmt(_('{where}.url is required'), { where }));
  const username = text(r, 'username', where);
  if (kind === 'deck' && username === undefined)
    throw new ConfigError(fmt(_('{where}.username is required for deck'), { where }));
  if (kind !== 'deck' && username !== undefined)
    throw new ConfigError(fmt(_('{where}.username is only used by deck'), { where }));
  const secret = text(r, 'secret', where) ?? `${id}:${secretPurposeOf(kind)}`;
  parseSecretRef(secret);
  const enabled = r.enabled ?? true;
  if (typeof enabled !== 'boolean') throw new ConfigError(fmt(_('{where}.enabled must be true or false'), { where }));
  let boards: string[] | undefined;
  if (r.boards !== undefined) {
    if (!Array.isArray(r.boards) || r.boards.some((b) => typeof b !== 'string' || b === ''))
      throw new ConfigError(fmt(_('{where}.boards must be a list of board ids'), { where }));
    boards = [...(r.boards as string[])];
  }
  if (r.lists !== undefined && kind !== 'zenkit')
    throw new ConfigError(fmt(_('{where}.lists is only used by zenkit'), { where }));
  const lists = r.lists === undefined ? undefined : parseLists(r.lists, where);
  const extra: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(r)) if (!KNOWN.has(key)) extra[key] = v;
  return {
    id,
    type: kind,
    ...(url !== undefined ? { url } : {}),
    ...(username !== undefined ? { username } : {}),
    secret,
    enabled,
    ...(boards ? { boards } : {}),
    ...(lists ? { lists } : {}),
    extra,
  };
}

/** `taken` are the ids already used by accounts: one namespace, because both key the cache. */
export function parseExternalSources(value: unknown, taken: readonly string[] = []): ExternalSourceConfig[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ConfigError(_('boardSources must be a list'));
  const seen = new Set(taken);
  return value.map((entry, index) => {
    const source = parseOne(entry, index);
    if (seen.has(source.id))
      throw new ConfigError(fmt(_('boardSources[{index}]: id "{id}" is used twice'), { index, id: source.id }));
    seen.add(source.id);
    return source;
  });
}

export function serializeExternalSource(source: ExternalSourceConfig): Record<string, unknown> {
  return {
    ...source.extra,
    id: source.id,
    type: source.type,
    ...(source.url !== undefined ? { url: source.url } : {}),
    ...(source.username !== undefined ? { username: source.username } : {}),
    secret: source.secret,
    ...(source.enabled ? {} : { enabled: false }),
    ...(source.boards ? { boards: source.boards } : {}),
    ...(source.lists ? { lists: source.lists } : {}),
  };
}
