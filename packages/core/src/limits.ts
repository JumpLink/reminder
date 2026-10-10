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

/** Default event window when the caller gives no `to`. */
export const EVENT_WINDOW_DAYS = 31;

/** A 0 or negative limit would `.slice(0, n)` into an empty answer that looks like "none". */
export function capLimit(value: number | undefined, spec: LimitSpec): number {
  if (value === undefined || !Number.isFinite(value)) return spec.default;
  return Math.max(1, Math.min(Math.floor(value), spec.max));
}
