/**
 * One failure, one type. Frontends branch on these, so a backend never lets a raw native error
 * through: a GLib.Error under GJS is a boxed GObject that JSON-serialises to `{}`.
 */
import { _, fmt } from './i18n.ts';

export class ReminderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The backend cannot load at all on this host (no EDS typelibs, for example). */
export class BackendUnavailableError extends ReminderError {}

/** A backend call failed; `domain`/`code` carry the GError metadata when there was one. */
export class BackendError extends ReminderError {
  readonly domain: string | undefined;
  readonly code: number | undefined;

  constructor(message: string, domain?: string, code?: number) {
    super(message);
    this.domain = domain;
    this.code = code;
  }
}

/** The server rejected the credentials (HTTP 401). Retrying with the same credentials cannot help. */
export class BackendAuthError extends BackendError {}

/**
 * The stored copy changed since it was read, so the write was refused (HTTP 412).
 *
 * Retrying is only correct after re-reading: the edit was computed from text that no longer is
 * what the server holds.
 */
export class ConflictError extends BackendError {}

/** The configured authentication scheme exists in the model but this build cannot speak it yet. */
export class UnsupportedAuthError extends ReminderError {
  readonly scheme: string;

  constructor(scheme: string) {
    super(fmt(_('authentication "{scheme}" is not supported yet — use "basic"'), { scheme }));
    this.scheme = scheme;
  }
}

/** The configuration file is invalid. Raised at load, never halfway through a write. */
export class ConfigError extends ReminderError {}

/** A write was refused because no grant names its capability and target. */
export class GrantDeniedError extends ReminderError {
  readonly capability: string;
  readonly target: string;

  constructor(capability: string, target: string) {
    super(
      fmt(_('no grant for {capability} on "{target}" — add {snippet} to grants'), {
        capability,
        target,
        snippet: `{ "capability": "${capability}", "target": "${target}" }`,
      }),
    );
    this.capability = capability;
    this.target = target;
  }
}

/** Neither an explicit calendar, a route nor a default names where an item should go. */
export class RoutingError extends ReminderError {}

/** Bad caller input: an unparseable date, an empty source key. */
export class InputError extends ReminderError {}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string')
    return err.message;
  return String(err);
}
