/**
 * The read path: one backend call, then parsing, filtering, ordering and the cap — here, so
 * every backend gets the same answer for the same data.
 */

import type { CalendarBackend } from './backend.ts';
import { shiftDate, todayUtc, toInstant } from './dates.ts';
import { readEvent, readReminder } from './ical.ts';
import { capLimit, EVENT_LIMIT, EVENT_WINDOW_DAYS, REMINDER_LIMIT } from './limits.ts';
import type { EventItem, ReminderItem } from './types.ts';

/** Code-unit order, not `localeCompare`: ICU may weigh `-` and `:` differently per locale. */
function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareDue(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compare(a, b);
}

export interface ListEventsParams {
  /** YYYY-MM-DD or ISO instant; default today (UTC). */
  from?: string;
  /** YYYY-MM-DD (inclusive: the whole day) or ISO instant; default from + 31 days. */
  to?: string;
  calendar?: string;
  limit?: number;
}

export interface ListEventsResult {
  from: string;
  to: string;
  events: EventItem[];
  /** How many matched beyond the limit — a cap that is not reported reads as "that's all". */
  omitted: number;
}

export async function listEvents(
  backend: CalendarBackend,
  params: ListEventsParams = {},
  now: Date = new Date(),
): Promise<ListEventsResult> {
  const fromDay = params.from ?? todayUtc(now);
  const from = toInstant(fromDay);
  const to = params.to
    ? toInstant(/^\d{4}-\d{2}-\d{2}$/.test(params.to) ? shiftDate(params.to, 1) : params.to)
    : toInstant(shiftDate(from.slice(0, 10), EVENT_WINDOW_DAYS));
  const raw = await backend.listItems({ kind: 'event', calendarUid: params.calendar, from, to });
  const events = raw
    .map((item) => readEvent(item.ical, item.calendarUid))
    .filter((e): e is EventItem => e !== null)
    .sort((a, b) => compare(a.start, b.start) || compare(a.uid, b.uid));
  const limit = capLimit(params.limit, EVENT_LIMIT);
  return { from, to, events: events.slice(0, limit), omitted: Math.max(0, events.length - limit) };
}

export interface ListRemindersParams {
  calendar?: string;
  /** Include completed and cancelled reminders; default only open ones. */
  all?: boolean;
  limit?: number;
}

export interface ListRemindersResult {
  reminders: ReminderItem[];
  omitted: number;
}

const DONE = new Set(['completed', 'cancelled']);

export async function listReminders(
  backend: CalendarBackend,
  params: ListRemindersParams = {},
): Promise<ListRemindersResult> {
  const raw = await backend.listItems({ kind: 'reminder', calendarUid: params.calendar });
  const reminders = raw
    .map((item) => readReminder(item.ical, item.calendarUid))
    .filter((r): r is ReminderItem => r !== null && (params.all === true || !DONE.has(r.status)))
    // Undated reminders last: a due date is what makes one urgent.
    .sort((a, b) => compareDue(a.due, b.due) || compare(a.uid, b.uid));
  const limit = capLimit(params.limit, REMINDER_LIMIT);
  return { reminders: reminders.slice(0, limit), omitted: Math.max(0, reminders.length - limit) };
}
