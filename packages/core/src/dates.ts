import { InputError } from './errors.ts';
import { _, fmt } from './i18n.ts';

/** Today as YYYY-MM-DD in UTC. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Shift a YYYY-MM-DD date by ±days. Throws on an unparseable input instead of "Invalid Date". */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(d.getTime()))
    throw new InputError(fmt(_('invalid date: {value}'), { value: date }));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A window bound → UTC ISO instant. A bare date is UTC midnight. */
export function toInstant(value: string): string {
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(ms)) throw new InputError(fmt(_('invalid date: {value}'), { value }));
  return new Date(ms).toISOString();
}
