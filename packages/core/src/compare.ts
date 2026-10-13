/** Ordering helpers shared by the read paths; internal, not part of the package surface. */

/** Code-unit order, not `localeCompare`: ICU may weigh `-` and `:` differently per locale. */
export function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Ascending, with a missing value last: no date never outranks a date. */
export function compareDue(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compare(a, b);
}
