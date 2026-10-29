/**
 * Priorities (docs/adr/0002): a VTODO with a PRIORITY, a DUE and a URL to its case file, whose
 * next steps are child VTODOs linked by `RELATED-TO;RELTYPE=PARENT`. Pure over the port's
 * iCalendar text, so every backend gets the same ranking and the same ages.
 */

import type { CalendarBackend } from './backend.ts';
import { compare, compareDue } from './compare.ts';
import { ConfigError } from './errors.ts';
import { readReminder } from './ical.ts';
import { capLimit, PRIORITY_LIMIT } from './limits.ts';
import type { ReminderItem } from './types.ts';
import { _, fmt } from './i18n.ts';

export interface PriorityStep {
  uid: string;
  summary: string | null;
  due: string | null;
  created: string | null;
  /** Local days since `created`; null when the step carries no creation time — never guessed. */
  daysOpen: number | null;
  /** True on the oldest open step only: the one to nag about. */
  nag: boolean;
}

export interface PriorityItem {
  uid: string;
  summary: string | null;
  /** 1 (highest) … 9 (lowest). */
  priority: number;
  due: string | null;
  /** Local days until `due`; negative = overdue; null without a deadline. */
  daysToDeadline: number | null;
  /** Age of the oldest open step; null when there is none or its age is unknown. */
  daysOpen: number | null;
  /** The case file `URL`, verbatim. */
  link: string | null;
  /** True when this item shares the lowest PRIORITY value with another: "the top one" is ambiguous. */
  tie: boolean;
  /** Open steps, oldest first. */
  steps: PriorityStep[];
}

export interface ListPrioritiesParams {
  /** The task list uid (`priorities.list` in the config). No default: none means an error. */
  list?: string;
  limit?: number;
}

export interface ListPrioritiesResult {
  /** The local date every age and deadline distance was computed against. */
  today: string;
  list: string;
  priorities: PriorityItem[];
  omitted: number;
}

const DONE = new Set(['completed', 'cancelled']);

const isOpen = (item: ReminderItem) => !DONE.has(item.status);

/** A date or instant as a local `YYYY-MM-DD`. A floating time already is local wall-clock. */
export function localDay(iso: string): string {
  if (iso.length === 10) return iso;
  if (!iso.endsWith('Z')) return iso.slice(0, 10);
  return formatLocal(new Date(iso));
}

function formatLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The host's calendar date, which is what "days" means to the person. */
export function localToday(now: Date = new Date()): string {
  return formatLocal(now);
}

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / 86_400_000;
}

function daysBetween(from: string, to: string): number {
  return Math.round(dayNumber(localDay(to)) - dayNumber(localDay(from)));
}

function toStep(item: ReminderItem, today: string): PriorityStep {
  return {
    uid: item.uid,
    summary: item.summary,
    due: item.due,
    created: item.created,
    daysOpen: item.created === null ? null : daysBetween(item.created, today),
    nag: false,
  };
}

/** Oldest first; a step of unknown age sorts after the dated ones so it cannot take the nag. */
function compareSteps(a: PriorityStep, b: PriorityStep): number {
  return compareDue(a.created, b.created) || compare(a.uid, b.uid);
}

/**
 * Rank the open priorities in `items` (all VTODOs of one list). Pure.
 *
 * A priority is an open VTODO with a PRIORITY and no parent. Its steps are its open children;
 * completed or cancelled children are ignored, and a child whose parent is not an open priority
 * of this list (an orphan) belongs to nothing and is dropped.
 */
export function rankPriorities(items: ReminderItem[], now: Date = new Date()): PriorityItem[] {
  const today = localToday(now);
  const open = items.filter(isOpen);
  const stepsByParent = new Map<string, ReminderItem[]>();
  for (const item of open) {
    if (item.parent === null) continue;
    const siblings = stepsByParent.get(item.parent);
    if (siblings) siblings.push(item);
    else stepsByParent.set(item.parent, [item]);
  }

  const ranked = open
    .filter((item) => item.parent === null && item.priority !== null)
    .map((item) => ({ item, priority: item.priority as number }))
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        compareDue(a.item.due, b.item.due) ||
        compareDue(a.item.created, b.item.created) ||
        compare(a.item.uid, b.item.uid),
    );

  const top = ranked[0]?.priority;
  const topCount = ranked.filter((r) => r.priority === top).length;

  return ranked.map(({ item, priority }) => {
    const steps = (stepsByParent.get(item.uid) ?? []).map((s) => toStep(s, today)).sort(compareSteps);
    if (steps.length > 0) steps[0].nag = true;
    return {
      uid: item.uid,
      summary: item.summary,
      priority,
      due: item.due,
      daysToDeadline: item.due === null ? null : daysBetween(today, item.due),
      daysOpen: steps[0]?.daysOpen ?? null,
      link: item.url,
      tie: topCount > 1 && priority === top,
      steps,
    };
  });
}

export async function listPriorities(
  backend: CalendarBackend,
  params: ListPrioritiesParams,
  now: Date = new Date(),
): Promise<ListPrioritiesResult> {
  const list = params.list;
  if (!list) {
    throw new ConfigError(
      fmt(_('no priorities list configured — set {snippet} (uids: `reminder calendars`)'), {
        snippet: '"priorities": { "list": "<task-list-uid>" }',
      }),
    );
  }
  // An unknown uid would otherwise read as an empty list: "no priorities" is not "wrong config".
  const lists = await backend.listCalendars('reminder');
  if (!lists.some((c) => c.uid === list)) {
    throw new ConfigError(fmt(_('priorities.list "{list}" is not an enabled task list (see `reminder calendars`)'), { list }));
  }
  const raw = await backend.listItems({ kind: 'reminder', calendarUid: list });
  const items = raw
    .map((r) => readReminder(r.ical, r.calendarUid))
    .filter((r): r is ReminderItem => r !== null);
  const priorities = rankPriorities(items, now);
  const limit = capLimit(params.limit, PRIORITY_LIMIT);
  const today = localToday(now);
  return {
    today,
    list,
    priorities: priorities.slice(0, limit),
    omitted: Math.max(0, priorities.length - limit),
  };
}
