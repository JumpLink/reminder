/**
 * One failure, one type. Frontends branch on these. The backend errors come from `@gjsify/pim`.
 */
import { _, fmt } from './i18n.ts';

// Backend failures are the PIM layer's; re-exported so frontends keep one import.
export {
  BackendAuthError,
  BackendError,
  BackendHttpError,
  BackendUnavailableError,
  ConflictError,
  errorMessage,
  PimError,
} from '@gjsify/pim';

export class ReminderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

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
