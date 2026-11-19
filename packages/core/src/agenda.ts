/**
 * The task view's grouping: open reminders into sections by how far off their due day is, the
 * finished ones apart. Pure — `now` comes in, and days are compared as calendar days of the
 * reader's own zone, like the due chip does, so a task due at 23:30 is "today" until midnight.
 *
 * Order inside a section is fully determined (due day, due text, priority, title, uid) with
 * code-unit comparison, so two runs over the same data never disagree.
 */

import { compare } from './compare.ts';
import type { ReminderItem } from './types.ts';

/** Days after today that still count as "upcoming"; later ones are "later". */
export const UPCOMING_DAYS = 7;

export type AgendaSectionId = 'overdue' | 'today' | 'upcoming' | 'later' | 'none';

/** Sections in display order. */
export const AGENDA_SECTIONS: readonly AgendaSectionId[] = ['overdue', 'today', 'upcoming', 'later', 'none'];

export interface AgendaSection {
  id: AgendaSectionId;
  items: ReminderItem[];
}

export interface Agenda {
  /** Only sections that hold something, in display order. */
  sections: AgendaSection[];
  /** Completed or cancelled, most recently finished first. */
  completed: ReminderItem[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;
const ZONE = /^(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

const dayNumber = (year: number, monthIndex: number, day: number): number =>
  Math.round(Date.UTC(year, monthIndex, day) / DAY_MS);

/**
 * The calendar day a due string falls on, as a day number — or null when it does not parse.
 * A bare date and a floating time are taken as written; an instant (`Z` or an offset) is moved to
 * the reader's zone first.
 */
export function dueDayNumber(due: string | null): number | null {
  if (due === null) return null;
  const m = DATE_TIME.exec(due);
  if (m === null) return null;
  if (m[4] !== undefined && ZONE.test(due.slice(m[0].length))) {
    const instant = new Date(due);
    if (Number.isNaN(instant.getTime())) return null;
    return dayNumber(instant.getFullYear(), instant.getMonth(), instant.getDate());
  }
  return dayNumber(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function isDone(item: ReminderItem): boolean {
  return item.status === 'completed' || item.status === 'cancelled';
}

export function sectionOf(item: ReminderItem, today: number): AgendaSectionId {
  const day = dueDayNumber(item.due);
  if (day === null) return 'none';
  if (day < today) return 'overdue';
  if (day === today) return 'today';
  return day - today <= UPCOMING_DAYS ? 'upcoming' : 'later';
}

const priorityRank = (p: number | null): number => (p === null ? 10 : p);

function byDue(a: ReminderItem, b: ReminderItem): number {
  const da = dueDayNumber(a.due) ?? Number.MAX_SAFE_INTEGER;
  const db = dueDayNumber(b.due) ?? Number.MAX_SAFE_INTEGER;
  return (
    da - db ||
    compare(a.due ?? '', b.due ?? '') ||
    priorityRank(a.priority) - priorityRank(b.priority) ||
    compare(a.summary ?? '', b.summary ?? '') ||
    compare(a.calendarUid, b.calendarUid) ||
    compare(a.uid, b.uid)
  );
}

function byFinished(a: ReminderItem, b: ReminderItem): number {
  return (
    compare(b.completed ?? '', a.completed ?? '') ||
    compare(a.summary ?? '', b.summary ?? '') ||
    compare(a.calendarUid, b.calendarUid) ||
    compare(a.uid, b.uid)
  );
}

export function buildAgenda(reminders: readonly ReminderItem[], now: Date): Agenda {
  const today = dayNumber(now.getFullYear(), now.getMonth(), now.getDate());
  const open = new Map<AgendaSectionId, ReminderItem[]>();
  const completed: ReminderItem[] = [];
  for (const item of reminders) {
    if (isDone(item)) {
      completed.push(item);
      continue;
    }
    const id = sectionOf(item, today);
    const list = open.get(id);
    if (list) list.push(item);
    else open.set(id, [item]);
  }
  const sections: AgendaSection[] = [];
  for (const id of AGENDA_SECTIONS) {
    const items = open.get(id);
    if (items && items.length > 0) sections.push({ id, items: items.sort(byDue) });
  }
  return { sections, completed: completed.sort(byFinished) };
}
