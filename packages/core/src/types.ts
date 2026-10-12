/**
 * The DTOs every frontend renders and every backend feeds.
 *
 * Times are ISO-8601 strings in one of three shapes, and the shape carries meaning:
 *
 *   2026-10-12             an all-day date (VALUE=DATE)
 *   2026-10-12T08:00:00Z   an absolute instant (UTC, or a TZID this runtime could resolve)
 *   2026-10-12T10:00:00    floating local time — no zone, or a TZID nobody could resolve
 *
 * A floating time is never silently converted: guessing a zone is how a reminder ends up an hour
 * early for half the year.
 */

/** What a calendar holds: VEVENTs or VTODOs. EDS keeps them in separate sources. */
export type ItemKind = 'event' | 'reminder';

export interface CalendarInfo {
  /** Backend-specific id; the target a grant and a route name. */
  uid: string;
  name: string;
  kind: ItemKind;
  /** Which backend serves it, e.g. `eds`. */
  backend: string;
  /** Display name of the collection/account it belongs to, when the backend knows one. */
  account: string | null;
}

export interface EventItem {
  uid: string;
  calendarUid: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  start: string;
  end: string | null;
  allDay: boolean;
  /** The TZID the start was written in, verbatim, or null. */
  timezone: string | null;
  /** True for a series definition; occurrences are not expanded. */
  recurring: boolean;
  /** Organizer address, `mailto:` stripped. */
  organizer: string | null;
  attendees: string[];
  /** The dedupe key this item was created with (`X-REMINDER-SOURCE`), or null. */
  source: string | null;
}

export type ReminderStatus = 'needs-action' | 'in-process' | 'completed' | 'cancelled' | 'unknown';

export interface ReminderItem {
  uid: string;
  calendarUid: string;
  summary: string | null;
  description: string | null;
  due: string | null;
  dueAllDay: boolean;
  completed: string | null;
  status: ReminderStatus;
  /** 1 (highest) … 9 (lowest); null when unset (0 in iCalendar). */
  priority: number | null;
  percentComplete: number | null;
  recurring: boolean;
  source: string | null;
  /** `CREATED`, falling back to `DTSTAMP` — some clients write only the latter; null when neither parses. */
  created: string | null;
  /** `URL`, verbatim (never fetched), or null. */
  url: string | null;
  /** UID of the parent VTODO (`RELATED-TO` with `RELTYPE=PARENT`, the RFC 5545 default), or null. */
  parent: string | null;
}

/** One raw component as a backend returns it: iCalendar text plus where it came from. */
export interface RawItem {
  calendarUid: string;
  ical: string;
}
