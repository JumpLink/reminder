/**
 * What the views show, decided without Gtk so it runs under Node tests: the overview's sections,
 * the task rows, the one-line sync status. The widgets only paint what this returns.
 */

import {
  _,
  buildAgenda,
  fmt,
  type Agenda,
  type AgendaSectionId,
  type CalendarInfo,
  type ReminderItem,
  type SourceStatus,
  type SyncState,
} from '@reminder/core';
import type { SourceSection, TaskRowData } from '@gjsify/adwaita-extended';

import type { SizeClass } from './constants.ts';

const PALETTE = ['#3584e4', '#33d17a', '#f6d32d', '#ff7800', '#e01b24', '#9141ac', '#986a44', '#2190a4'];

/** A stable colour per source: the backends report none, and the same list must not change colour. */
export function colourFor(uid: string): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) hash = (hash * 31 + uid.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export type OverviewContainer = 'bottom-sheet' | 'overlay' | 'docked';

/** Compact opens the list in a bottom sheet, medium as an overlay sidebar, wide docks it. */
export function overviewContainerFor(sizeClass: SizeClass): OverviewContainer {
  switch (sizeClass) {
    case 'compact':
      return 'bottom-sheet';
    case 'medium':
      return 'overlay';
    case 'wide':
      return 'docked';
  }
}

/** Calendars, task lists and (once a backend serves them) boards; empty sections are left out. */
export function buildSourceSections(
  calendars: readonly CalendarInfo[],
  hidden: ReadonlySet<string>,
): SourceSection[] {
  const item = (c: CalendarInfo) => ({
    id: c.uid,
    name: c.name,
    colour: colourFor(c.uid),
    visible: !hidden.has(c.uid),
    ...(c.account ? { account: c.account } : {}),
  });
  const sections: SourceSection[] = [
    { title: _('Calendars'), sources: calendars.filter((c) => c.kind === 'event').map(item) },
    { title: _('Task lists'), sources: calendars.filter((c) => c.kind === 'reminder').map(item) },
  ];
  return sections.filter((s) => s.sources.length > 0);
}

export function visibleReminders(
  items: readonly ReminderItem[],
  hidden: ReadonlySet<string>,
): ReminderItem[] {
  return items.filter((i) => !hidden.has(i.calendarUid));
}

export function buildVisibleAgenda(
  items: readonly ReminderItem[],
  hidden: ReadonlySet<string>,
  now: Date,
): Agenda {
  return buildAgenda(visibleReminders(items, hidden), now);
}

export function sectionTitle(id: AgendaSectionId): string {
  switch (id) {
    case 'overdue':
      return _('Overdue');
    case 'today':
      return _('Today');
    case 'upcoming':
      return _('Upcoming');
    case 'later':
      return _('Later');
    case 'none':
      return _('No date');
  }
}

/** The due string as a local `Date` for the row's chip; a bare date is that day, not UTC midnight. */
export function dueDate(item: ReminderItem): Date | null {
  if (item.due === null) return null;
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(item.due);
  const date = bare ? new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3])) : new Date(item.due);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toRowData(item: ReminderItem, list: { name: string; colour: string }): TaskRowData {
  return {
    title: item.summary ?? _('Untitled'),
    listName: list.name,
    colour: list.colour,
    done: item.status === 'completed' || item.status === 'cancelled',
    due: dueDate(item),
    priority: item.priority,
  };
}

/** What a sync state is called in a banner; null while a source is current or still trying. */
export function stateLabel(state: SyncState): string | null {
  switch (state.kind) {
    case 'auth-rejected':
      return _('sign-in rejected');
    case 'no-access':
      return _('no access');
    case 'rate-limited':
      return _('rate limited');
    case 'unreadable':
      return _('cannot be read');
    case 'stale':
      return _('could not be updated');
    case 'pending':
    case 'current':
      return null;
  }
}

/** One line for a banner, or null while every source is current or still loading. */
export function describeSyncProblems(
  sources: readonly { name: string; status: SourceStatus | null }[],
): string | null {
  const parts: string[] = [];
  for (const { name, status } of sources) {
    const label = status ? stateLabel(status.state) : null;
    if (label !== null) parts.push(`${name}: ${label}`);
  }
  return parts.length === 0 ? null : fmt(_('Not up to date — {sources}'), { sources: parts.join(', ') });
}
