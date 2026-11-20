/**
 * Result caps, in ONE place: the action clamps, the MCP schema declares `.max()`, and the CLI help
 * quotes them. Three hand-written copies drift, and the one that drifts is the schema.
 */

export interface LimitSpec {
  default: number;
  max: number;
}

export const EVENT_LIMIT: LimitSpec = { default: 100, max: 500 };
export const REMINDER_LIMIT: LimitSpec = { default: 100, max: 500 };
export const PRIORITY_LIMIT: LimitSpec = { default: 50, max: 200 };
export const BOARD_LIMIT: LimitSpec = { default: 50, max: 200 };
export const CARD_LIMIT: LimitSpec = { default: 100, max: 500 };

/** Default event window when the caller gives no `to`. */
export const EVENT_WINDOW_DAYS = 31;

/**
 * Longest window `events_list` expands. Expansion multiplies the answer (a daily series is 31
 * rows a month), so the window is clamped — and the clamp is reported, never silent.
 */
export const EXPAND_WINDOW_MAX_DAYS = 92;

/** A 0 or negative limit would `.slice(0, n)` into an empty answer that looks like "none". */
export function capLimit(value: number | undefined, spec: LimitSpec): number {
  if (value === undefined || !Number.isFinite(value)) return spec.default;
  return Math.max(1, Math.min(Math.floor(value), spec.max));
}

/** The kinds of source the sync service schedules (docs/adr/0017). */
export type SyncSourceKind = 'caldav' | 'eds' | 'deck' | 'openproject' | 'zenkit';

/** How often a source is refetched while everything works. A failure doubles it up to the cap. */
export const SYNC_INTERVAL_MS: Record<SyncSourceKind, number> = {
  caldav: 5 * 60_000,
  eds: 2 * 60_000,
  deck: 2 * 60_000,
  openproject: 5 * 60_000,
  zenkit: 10 * 60_000,
};

/** Back-off ceiling: a source that keeps failing is still tried twice an hour. */
export const SYNC_MAX_INTERVAL_MS = 30 * 60_000;

/** Concurrent fetches against one server (host). */
export const SYNC_MAX_PER_HOST = 2;

/** A window-focus refresh skips a source that finished an attempt more recently than this. */
export const SYNC_FOCUS_MIN_GAP_MS = 30_000;
