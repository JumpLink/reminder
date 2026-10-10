/**
 * One failure, one type. Frontends branch on these, so a backend never lets a raw native error
 * through: a GLib.Error under GJS is a boxed GObject that JSON-serialises to `{}`.
 */

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

/** The configuration file is invalid. Raised at load, never halfway through a write. */
export class ConfigError extends ReminderError {}

/** A write was refused because no grant names its capability and target. */
export class GrantDeniedError extends ReminderError {
  readonly capability: string;
  readonly target: string;

  constructor(capability: string, target: string) {
    super(
      `no grant for ${capability} on "${target}" — add { "capability": "${capability}", "target": "${target}" } to grants`,
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
