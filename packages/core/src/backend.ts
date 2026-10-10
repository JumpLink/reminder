/**
 * The CalendarBackend port — the seam between what reminder decides and where the data lives.
 *
 * A backend moves iCalendar TEXT and nothing else. Parsing, dedupe, grants and routing live in
 * this package, so a second backend (CalDAV over `@gjsify/system-accounts`) is a transport and
 * not a second copy of those rules. CalDAV speaks iCalendar on the wire; EDS hands out the same
 * text via `as_ical_string()`.
 */

import type { CalendarInfo, ItemKind, RawItem } from './types.ts';

export interface ItemQuery {
  kind: ItemKind;
  /** Restrict to one calendar; otherwise every enabled calendar of that kind. */
  calendarUid?: string;
  /** Events only: the window, as UTC ISO instants. Ignored for reminders. */
  from?: string;
  to?: string;
}

export interface CalendarBackend {
  /** Short id, shown in `CalendarInfo.backend`. */
  readonly id: string;
  listCalendars(kind?: ItemKind): Promise<CalendarInfo[]>;
  /** Components in the query's scope. Events: those with an occurrence in [from, to]. */
  listItems(query: ItemQuery): Promise<RawItem[]>;
  /** One component by UID, or null when the calendar has none with that UID. */
  getItem(calendarUid: string, kind: ItemKind, uid: string): Promise<string | null>;
  /** Store one VEVENT/VTODO; returns the UID the backend recorded. Refuses a read-only calendar. */
  createItem(calendarUid: string, kind: ItemKind, ical: string): Promise<string>;
}
