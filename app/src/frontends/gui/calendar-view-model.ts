/**
 * What the calendar view shows, decided without Gtk so it runs under Node tests: which days a mode
 * covers, where previous/next lands, how the header reads, and how an expanded occurrence becomes
 * the `CalendarEvent` the widgets paint.
 *
 * Nothing here converts a time zone that did not resolve (ADR 0009). A floating occurrence is read
 * exactly as it was written and carries a clock marker instead; only a real instant (`…Z` or an
 * offset) is moved into the reader's zone, which is what an instant means.
 */

import {
  dateFromDayNumber,
  dayNumber,
  daysInMonth,
  monthGrid,
  weekdayOf,
  type LocalDate,
  type LocalDateTime,
  type Weekday,
} from '@gjsify/calendar-layout';
import { dayHeading, isoDate, monthTitle, timeLabel } from '@gjsify/adwaita-extended/calendar-format';
import type { CalendarEvent } from '@gjsify/adwaita-extended';

import { _, fmt } from '@reminder/core';

import type { SizeClass } from './constants.ts';
import type { WeekStart } from './settings.ts';

export const CALENDAR_MODES = ['month', 'week', 'day'] as const;
export type CalendarMode = (typeof CALENDAR_MODES)[number];

export function isCalendarMode(value: unknown): value is CalendarMode {
  return typeof value === 'string' && (CALENDAR_MODES as readonly string[]).includes(value);
}

/** The days one mode draws: where they start and how many there are. */
export interface CalendarWindow {
  first: LocalDate;
  days: number;
}

/**
 * Columns the week mode draws. A time column needs `MIN_DAY_WIDTH` (96px) and the hour gutter
 * takes its own: seven of them want ~720px, which only the wide rung has. Medium gets five — the
 * working week, and 528px of it — and a phone three. The whole week stays one tap away in the
 * month mode, so nothing is unreachable at any width.
 */
export function weekColumns(sizeClass: SizeClass): number {
  switch (sizeClass) {
    case 'wide':
      return 7;
    case 'medium':
      return 5;
    case 'compact':
      return 3;
  }
}

/** Monday unless the locale or the person says otherwise; `system` asks CLDR through `Intl`. */
export function firstWeekdayFor(weekStart: WeekStart, locale?: string): Weekday {
  switch (weekStart) {
    case 'monday':
      return 1;
    case 'sunday':
      return 0;
    case 'saturday':
      return 6;
    case 'system':
      return localeFirstWeekday(locale);
  }
}

/** CLDR counts 1 = Monday … 7 = Sunday; `% 7` turns that into this repo's 0 = Sunday. */
function localeFirstWeekday(locale?: string): Weekday {
  try {
    const name = locale ?? new Intl.DateTimeFormat().resolvedOptions().locale;
    const info = new Intl.Locale(name) as unknown as {
      getWeekInfo?: () => { firstDay?: number };
      weekInfo?: { firstDay?: number };
    };
    const first = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    if (typeof first === 'number' && first >= 1 && first <= 7) return (first % 7) as Weekday;
  } catch {
    // No week info in this engine's `Intl`: ISO 8601 is the better guess than the machine's.
  }
  return 1;
}

/** The day the week holding `date` starts on. */
export function startOfWeek(date: LocalDate, firstWeekday: Weekday): LocalDate {
  const back = (((weekdayOf(date) - firstWeekday) % 7) + 7) % 7;
  return dateFromDayNumber(dayNumber(date) - back);
}

/**
 * The days a mode covers. Month always takes the whole six-row grid, including the days of the
 * neighbouring months the grid shows — a bar that starts on the 31st of the month before has to be
 * loaded to be drawn.
 *
 * A full week starts on the first weekday; a short one starts at the anchor and runs forward, so
 * previous/next is a plain shift by the same number of days rather than a jump that re-aligns.
 */
export function calendarWindow(
  mode: CalendarMode,
  anchor: LocalDate,
  firstWeekday: Weekday,
  columns: number = 7,
): CalendarWindow {
  switch (mode) {
    case 'month': {
      const grid = monthGrid({ year: anchor.year, month: anchor.month, firstWeekday, sixRows: true });
      return { first: grid.weeks[0].days[0].date, days: grid.weeks.length * 7 };
    }
    case 'week':
      return columns >= 7
        ? { first: startOfWeek(anchor, firstWeekday), days: 7 }
        : { first: anchor, days: Math.max(1, columns) };
    case 'day':
      return { first: anchor, days: 1 };
  }
}

/** The window as the inclusive `YYYY-MM-DD` bounds `expandEvents` takes. */
export function windowRange(window: CalendarWindow): { from: string; to: string } {
  return {
    from: isoDate(window.first),
    to: isoDate(dateFromDayNumber(dayNumber(window.first) + window.days - 1)),
  };
}

/** Where previous (-1) and next (+1) land. A short week steps by its own column count. */
export function shiftAnchor(
  mode: CalendarMode,
  anchor: LocalDate,
  delta: number,
  columns: number = 7,
): LocalDate {
  switch (mode) {
    case 'month': {
      const months = anchor.year * 12 + anchor.month - 1 + delta;
      const year = Math.floor(months / 12);
      const month = months - year * 12 + 1;
      // The 31st before a 30-day month: clamp rather than roll over into the month after.
      return { year, month, day: Math.min(anchor.day, daysInMonth(year, month)) };
    }
    case 'week':
      return dateFromDayNumber(dayNumber(anchor) + delta * (columns >= 7 ? 7 : Math.max(1, columns)));
    case 'day':
      return dateFromDayNumber(dayNumber(anchor) + delta);
  }
}

/** What the header says: the month, the span of days, or the one day. */
export function calendarTitle(
  mode: CalendarMode,
  anchor: LocalDate,
  window: CalendarWindow,
  locale?: string,
): string {
  if (mode === 'month') return monthTitle(anchor.year, anchor.month, locale);
  if (mode === 'day' || window.days <= 1) return dayHeading(anchor, locale);
  const last = dateFromDayNumber(dayNumber(window.first) + window.days - 1);
  // The dash is punctuation, not language: no catalogue entry, the same way the widgets write ranges.
  return `${spanLabel(window.first, last, locale)} – ${rangeEnd(last, locale)}`;
}

/** The start of a span: the day alone while the month and year match the end, else the full date. */
function spanLabel(first: LocalDate, last: LocalDate, locale?: string): string {
  if (first.year === last.year && first.month === last.month)
    return new Intl.DateTimeFormat(locale, { day: 'numeric', timeZone: 'UTC' }).format(utc(first));
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    utc(first),
  );
}

function rangeEnd(last: LocalDate, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(utc(last));
}

function utc(date: LocalDate): Date {
  const value = new Date(0);
  value.setUTCFullYear(date.year, date.month - 1, date.day);
  value.setUTCHours(0, 0, 0, 0);
  return value;
}

/** The fields of an expanded occurrence this layer reads; `ExpandedOccurrence` satisfies it. */
export interface CalendarOccurrence {
  uid: string;
  calendarUid: string;
  summary: string | null;
  /** UTC instant (`…Z`), `YYYY-MM-DD` when all-day, or a bare wall clock when floating. */
  start: string;
  /** Exclusive, same form as `start`. */
  end: string;
  allDay: boolean;
  floating: boolean;
  tzid: string | null;
  recurrenceId?: string | null;
  location?: string | null;
  url?: string | null;
  zoneUnresolved: boolean;
}

/**
 * Identity of one instance: the series slot tells two instances of a series apart, and the
 * calendar keeps two calendars that share a uid apart. Stable across a reload, which is what the
 * detail pane looks an activated id up by.
 */
export function occurrenceId(o: CalendarOccurrence): string {
  return `${o.calendarUid}\n${o.uid}\n${o.recurrenceId ?? o.start}`;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const INSTANT = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * An occurrence bound as the wall calendar shows it. A bare date and a floating time are taken as
 * written; an instant is read in the reader's own zone, which is what an instant means. Null when
 * the string is none of the three.
 */
export function wallClock(value: string): LocalDateTime | null {
  const date = DATE_ONLY.exec(value);
  if (date) return { year: Number(date[1]), month: Number(date[2]), day: Number(date[3]) };
  const wall = WALL.exec(value);
  if (!wall) return null;
  if (!INSTANT.test(value))
    return {
      year: Number(wall[1]),
      month: Number(wall[2]),
      day: Number(wall[3]),
      hour: Number(wall[4]),
      minute: Number(wall[5]),
    };
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  return {
    year: at.getFullYear(),
    month: at.getMonth() + 1,
    day: at.getDate(),
    hour: at.getHours(),
    minute: at.getMinutes(),
  };
}

/**
 * The marker an unresolvable time zone adds to a title. The widgets paint a title and nothing
 * else, so the flag has to travel in it — the detail pane then spells out what it means. Never a
 * conversion: the time beside it is the time as written.
 */
export const ZONE_MARK = '⏱';

/** "time zone Europe/Nowhere unknown — shown as entered", the detail line of a flagged item. */
export function zoneNote(o: CalendarOccurrence): string | null {
  if (!o.zoneUnresolved) return null;
  return fmt(_('Time zone {zone} unknown — shown as entered'), { zone: o.tzid ?? '' });
}

export function eventTitle(o: CalendarOccurrence): string {
  const title = o.summary ?? _('(no title)');
  return o.zoneUnresolved ? `${title} ${ZONE_MARK}` : title;
}

/**
 * When an instance runs, for the detail pane: "All day", "09:30 – 10:15", or the two ends written
 * out when it crosses midnight. A flagged zone adds nothing here — {@link zoneNote} says it in
 * words on a line of its own.
 */
export function occurrenceSpan(o: CalendarOccurrence, locale?: string): string {
  const start = wallClock(o.start);
  const end = wallClock(o.end);
  if (start === null || end === null) return '';
  if (o.allDay) {
    // DTEND of an all-day item is exclusive: the last day on screen is the one before it.
    const last = dateFromDayNumber(Math.max(dayNumber(start), dayNumber(end) - 1));
    if (dayNumber(last) === dayNumber(start)) return _('All day');
    return `${_('All day')}, ${dayHeading(start, locale)} – ${dayHeading(last, locale)}`;
  }
  const from = timeLabel((start.hour ?? 0) * 60 + (start.minute ?? 0), locale);
  const to = timeLabel((end.hour ?? 0) * 60 + (end.minute ?? 0), locale);
  if (dayNumber(start) === dayNumber(end)) return `${from} – ${to}`;
  return `${dayHeading(start, locale)}, ${from} – ${dayHeading(end, locale)}, ${to}`;
}

/**
 * Expanded occurrences as the calendar widgets want them: hidden sources dropped, a colour per
 * source, and anything whose bounds do not parse left out rather than drawn at the epoch.
 */
export function toCalendarEvents(
  occurrences: readonly CalendarOccurrence[],
  hidden: ReadonlySet<string>,
  colourOf: (calendarUid: string) => string,
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const o of occurrences) {
    if (hidden.has(o.calendarUid)) continue;
    const start = wallClock(o.start);
    const end = wallClock(o.end);
    if (start === null || end === null) continue;
    events.push({
      id: occurrenceId(o),
      start,
      end,
      allDay: o.allDay,
      payload: {
        title: eventTitle(o),
        colour: colourOf(o.calendarUid),
        ...(o.location ? { location: o.location } : {}),
      },
    });
  }
  return events;
}

/** The hour a time grid opens at when nothing else decides: early enough for a morning. */
export const DEFAULT_FOCUS_HOUR = 7;

/**
 * Where the time grid should be scrolled when a window is first drawn. A grid that opens at
 * midnight wastes most of its height on hours nothing happens in, so it opens an hour before the
 * first timed event instead — or at the current hour when today is one of the days on screen,
 * because that is what a reader checking the day is looking for.
 */
export function focusHour(events: readonly CalendarEvent[], window: CalendarWindow, now: Date): number {
  const first = dayNumber(window.first);
  const todayNumber = dayNumber({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
  if (todayNumber >= first && todayNumber < first + window.days) {
    return Math.max(0, Math.min(23, now.getHours() - 1));
  }
  let earliest: number | null = null;
  for (const event of events) {
    if (event.allDay) continue;
    const day = dayNumber(event.start);
    if (day < first || day >= first + window.days) continue;
    const hour = event.start.hour ?? 0;
    if (earliest === null || hour < earliest) earliest = hour;
  }
  return Math.max(0, Math.min(23, (earliest ?? DEFAULT_FOCUS_HOUR + 1) - 1));
}

/** One line per source that could not be read, for the banner over the grid (ADR 0005). */
export function describeCalendarFailures(
  failures: readonly { name: string; message: string }[],
): string | null {
  if (failures.length === 0) return null;
  return fmt(_('Not up to date — {sources}'), {
    sources: failures.map((f) => `${f.name}: ${f.message}`).join(', '),
  });
}
