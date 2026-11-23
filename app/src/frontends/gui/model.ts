/**
 * The task view's state, without Gtk so it runs under Node tests: the reminders every source's
 * cache entry holds, per-source sync status, and the write path (complete / reopen / postpone).
 *
 * Reads come from the sync service's cache entries, so what the window shows is what the cache
 * holds and "stale" can be told apart from "gone". Writes go through the core's `updateReminder`,
 * which checks the grant itself; `writable` only keeps the UI from offering what it would refuse.
 */

import {
  _,
  cacheKeyOfTarget,
  shiftDate,
  type AgendaOccurrence,
  ConflictError,
  decodeCollectionBody,
  errorMessage,
  isGranted,
  readReminder,
  targetOfCacheKey,
  updateReminder,
  type CacheKey,
  type CalendarBackend,
  type CalendarInfo,
  type ReminderConfig,
  type ReminderItem,
  type SourceStatus,
  type SyncService,
} from '@reminder/core';

import { expandEvents } from '../../core/expand-events.ts';

export type WriteOutcome =
  | { kind: 'ok' }
  | { kind: 'denied' }
  | { kind: 'conflict' }
  | { kind: 'failed'; message: string };

export interface TasksModelDeps {
  config: ReminderConfig;
  /** Multiplexed, disabled sources already cut — what `Context.backend()` returns. */
  backend: CalendarBackend;
  /** Null when no source could be synced; the model then only has what a reload finds. */
  service: SyncService | null;
  now?: () => Date;
}

export interface TasksModel {
  /** Lists the calendars; reminders arrive through the sync service. */
  load(): Promise<void>;
  calendars(): CalendarInfo[];
  reminders(): ReminderItem[];
  /** Occurrences of events around today (recurring ones expanded); the view keeps today's. */
  occurrences(): AgendaOccurrence[];
  /** The list a reminder belongs to, for its colour and name. */
  calendar(uid: string): CalendarInfo | null;
  writable(calendarUid: string): boolean;
  setDone(item: ReminderItem, done: boolean): Promise<WriteOutcome>;
  postpone(item: ReminderItem): Promise<WriteOutcome>;
  syncStatus(): { name: string; status: SourceStatus | null }[];
  subscribe(listener: () => void): () => void;
  focus(): void;
  refresh(): void;
}

const pad = (n: number): string => String(n).padStart(2, '0');

export function tomorrow(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Where postponing moves a task: tomorrow, at the same time of day when the task has one. A due
 * time in floating time names no instant to keep, so it becomes a bare date.
 */
export function postponedDue(item: ReminderItem, now: Date): string {
  const day = tomorrow(now);
  if (!item.due || item.dueAllDay || !/(Z|[+-]\d{2}:?\d{2})$/.test(item.due)) return day;
  const at = new Date(item.due);
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, at.getHours(), at.getMinutes());
  return next.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function createTasksModel(deps: TasksModelDeps): TasksModel {
  const { config, backend, service } = deps;
  const now = deps.now ?? (() => new Date());
  let calendars: CalendarInfo[] = [];
  const byTarget = new Map<string, ReminderItem[]>();
  const statuses = new Map<string, SourceStatus>();
  const listeners = new Set<() => void>();
  let occurrences: AgendaOccurrence[] = [];
  const loadOccurrences = async (): Promise<void> => {
    const d = now();
    const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    try {
      // A day either side: all-day and floating values are read as UTC, the view cuts to today.
      const result = await expandEvents(backend, { from: shiftDate(day, -1), to: shiftDate(day, 1) }, d);
      occurrences = result.occurrences.map((o) => ({
        uid: o.uid,
        calendarUid: o.calendarUid,
        summary: o.summary,
        start: o.start,
        end: o.end,
        allDay: o.allDay,
        floating: o.floating,
        tzid: o.tzid,
        override: o.override,
        zoneUnresolved: o.zoneUnresolved,
      }));
    } catch {
      // Events are an extra on the task view: a calendar that cannot be read leaves the tasks alone.
      occurrences = [];
    }
  };
  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const ingest = (key: CacheKey, body: string): void => {
    const target = targetOfCacheKey(config.accounts, key);
    const items = decodeCollectionBody(body);
    if (items === null) return;
    byTarget.set(
      target,
      items.map((i) => readReminder(i.ical, target)).filter((r): r is ReminderItem => r !== null),
    );
  };

  service?.subscribe((key, status, entry) => {
    statuses.set(targetOfCacheKey(config.accounts, key), status);
    if (entry) ingest(key, entry.body);
    notify();
  });

  const write = async (
    item: ReminderItem,
    changes: { status?: 'completed' | 'needs-action'; due?: string },
  ): Promise<WriteOutcome> => {
    if (!isGranted(config.grants, 'reminder.update', item.calendarUid)) return { kind: 'denied' };
    try {
      const result = await updateReminder(
        { backend, config, now },
        { calendar: item.calendarUid, uid: item.uid, ...changes },
      );
      if (result.reminder) {
        const list = byTarget.get(item.calendarUid) ?? [];
        byTarget.set(
          item.calendarUid,
          list.map((r) => (r.uid === item.uid ? (result.reminder as ReminderItem) : r)),
        );
      }
      const key = cacheKeyOfTarget(config.accounts, item.calendarUid);
      if (key) service?.refresh(key);
      notify();
      return { kind: 'ok' };
    } catch (err) {
      if (err instanceof ConflictError) {
        const key = cacheKeyOfTarget(config.accounts, item.calendarUid);
        if (key) service?.refresh(key);
        return { kind: 'conflict' };
      }
      return { kind: 'failed', message: errorMessage(err) };
    }
  };

  return {
    async load() {
      calendars = await backend.listCalendars();
      await loadOccurrences();
      notify();
    },
    calendars: () => [...calendars],
    reminders: () => [...byTarget.values()].flat(),
    occurrences: () => [...occurrences],
    calendar: (uid) => calendars.find((c) => c.uid === uid) ?? null,
    writable: (uid) => isGranted(config.grants, 'reminder.update', uid),
    setDone: (item, done) => write(item, { status: done ? 'completed' : 'needs-action' }),
    postpone: (item) => write(item, { due: postponedDue(item, now()) }),
    syncStatus: () =>
      calendars
        .filter((c) => c.kind === 'reminder')
        .map((c) => ({ name: c.name || _('Untitled'), status: statuses.get(c.uid) ?? null })),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    focus: () => service?.focus(),
    refresh() {
      service?.refresh();
      void loadOccurrences().then(notify);
    },
  };
}
