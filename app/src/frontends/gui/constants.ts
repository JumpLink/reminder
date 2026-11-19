/**
 * Everything the GUI frontend names or measures in ONE place (ADR 0012): the app identity, the
 * three size classes and the view ids. No `gi://` here, so the thresholds are tested on Node.
 */

import { IDENTITY } from '../../core/identity.ts';

export { VERSION as APP_VERSION } from '../../core/runtime.ts';

export const APP_ID = IDENTITY.appId;
export const APP_NAME = IDENTITY.displayName;

/** Env-var prefix for the `@gjsify/adwaita-app` dev hooks (`REMINDER_APP_VIEW`, `…_DEBUG`). */
export const DEV_HOOK_PREFIX = 'REMINDER_APP';

/** `REMINDER_APP_SIZE="W H"` — the window's default size; a screenshot rig needs it before the window maps. */
export const SIZE_HOOK = `${DEV_HOOK_PREFIX}_SIZE`;

/** Lower bound of the medium class, in `sp` so it follows the user's text scale. */
export const COMPACT_MAX_SP = 600;
/** Lower bound of the wide class, in `sp`. */
export const WIDE_MIN_SP = 1024;

export type SizeClass = 'compact' | 'medium' | 'wide';

export const SIZE_CLASSES: readonly SizeClass[] = ['compact', 'medium', 'wide'];

/** The class a window of `widthSp` belongs to. Exactly one, at every width. */
export function sizeClassFor(widthSp: number): SizeClass {
  if (widthSp < COMPACT_MAX_SP) return 'compact';
  if (widthSp < WIDE_MIN_SP) return 'medium';
  return 'wide';
}

/** One `Adw.BreakpointCondition` per class; the rungs do not overlap and leave no gap. */
export const BREAKPOINT_CONDITIONS: Readonly<Record<SizeClass, string>> = {
  compact: `max-width: ${COMPACT_MAX_SP - 1}sp`,
  medium: `min-width: ${COMPACT_MAX_SP}sp and max-width: ${WIDE_MIN_SP - 1}sp`,
  wide: `min-width: ${WIDE_MIN_SP}sp`,
};

/** Stack child names, in switcher order; also the `win.view-<name>` action suffixes. */
export const VIEW_NAMES = ['calendar', 'tasks', 'board'] as const;
export type ViewName = (typeof VIEW_NAMES)[number];

/** Narrowest and shortest window the layout is built for (a phone in portrait). */
export const MIN_WIDTH = 360;
export const MIN_HEIGHT = 294;

/** `REMINDER_APP_PREFS=1` opens the preferences at start, for screenshots; a page name opens that page. */
export const PREFS_HOOK = `${DEV_HOOK_PREFIX}_PREFS`;
