/**
 * Events with their recurring instances written out. The expander lives here and not in
 * `@reminder/core` (ADR 0009: the core keeps no new dependency); the core only sees the result
 * through `AgendaOccurrence`.
 *
 * Expansion is explicit (`events_list` `expand`, `reminder events --expand`): the default read
 * still returns one row per series. An expanded answer multiplies rows, so the window is clamped
 * and the row count capped — and both are reported, never silent.
 */

import {
  createWindowCache,
  expand,
  type Occurrence,
  type SeriesCut,
  type WindowCache,
} from '@gjsify/recurrence';
import {
  _,
  capLimit,
  EVENT_LIMIT,
  EVENT_WINDOW_DAYS,
  EXPAND_WINDOW_MAX_DAYS,
  fmt,
  InputError,
  shiftDate,
  todayUtc,
  toInstant,
  type CalendarBackend,
} from '@reminder/core';

export interface ExpandEventsParams {
  /** YYYY-MM-DD or ISO instant; default today (UTC). */
  from?: string;
  /** YYYY-MM-DD (inclusive: the whole day) or ISO instant; default from + 31 days. */
  to?: string;
  calendar?: string;
  limit?: number;
}

export interface ExpandedOccurrence extends Occurrence {
  calendarUid: string;
  /** The TZID resolved to nothing: `start` and `end` are wall clocks, not instants. */
  zoneUnresolved: boolean;
}

export interface ExpandEventsResult {
  from: string;
  /** Exclusive, after clamping. */
  to: string;
  /** True when the requested window was longer than {@link EXPAND_WINDOW_MAX_DAYS} and was cut. */
  clamped: boolean;
  occurrences: ExpandedOccurrence[];
  /** How many instances matched beyond the limit. */
  omitted: number;
  /** One entry per series that hit the per-series cap of the expander. */
  cuts: SeriesCut[];
  /** TZIDs that resolved to neither a VTIMEZONE nor a zone the host knows. */
  unresolvedZones: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const codeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const uidOf = (ical: string): string => /^UID:(.*)$/m.exec(ical.replace(/\r/g, ''))?.[1] ?? '';

/**
 * The listing carries no ETag, so the text itself is the version: identical text gives an
 * identical expansion, changed text a new key. A hash is enough because a collision only needs
 * the same uid, window and length to matter.
 */
export function versionOf(ical: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < ical.length; i++) {
    h ^= ical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${ical.length}-${(h >>> 0).toString(16)}`;
}

/** A backend may hand back a bare component; the expander wants the VCALENDAR around it. */
const asCalendar = (ical: string): string =>
  /^BEGIN:VCALENDAR/m.test(ical)
    ? ical
    : `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//reminder//EN\r\n${ical.replace(/\r?\n$/, '')}\r\nEND:VCALENDAR\r\n`;

/** Shared by every caller in the process, so a view that repaints does not re-expand. */
const sharedCache = createWindowCache();

export async function expandEvents(
  backend: CalendarBackend,
  params: ExpandEventsParams = {},
  now: Date = new Date(),
  cache: WindowCache = sharedCache,
): Promise<ExpandEventsResult> {
  const from = toInstant(params.from ?? todayUtc(now));
  const requested = params.to
    ? toInstant(/^\d{4}-\d{2}-\d{2}$/.test(params.to) ? shiftDate(params.to, 1) : params.to)
    : toInstant(shiftDate(from.slice(0, 10), EVENT_WINDOW_DAYS));
  if (Date.parse(requested) < Date.parse(from))
    throw new InputError(fmt(_('window ends before it starts: {from} – {to}'), { from, to: requested }));
  const ceiling = new Date(Date.parse(from) + EXPAND_WINDOW_MAX_DAYS * DAY_MS).toISOString();
  const clamped = requested > ceiling;
  const to = clamped ? ceiling : requested;

  const raw = await backend.listItems({ kind: 'event', calendarUid: params.calendar, from, to });
  const occurrences: ExpandedOccurrence[] = [];
  const cuts: SeriesCut[] = [];
  const zones = new Set<string>();
  const window = { from, to };
  for (const item of raw) {
    const key = { uid: `${item.calendarUid}/${uidOf(item.ical)}`, version: versionOf(item.ical), window };
    let result = cache.get(key);
    if (result === null) {
      try {
        result = expand(asCalendar(item.ical), window);
      } catch {
        // One unreadable item must not hide the rest of the calendar.
        continue;
      }
      cache.put(key, result);
    }
    for (const o of result.occurrences)
      occurrences.push({
        ...o,
        calendarUid: item.calendarUid,
        zoneUnresolved: o.floating && o.tzid !== null,
      });
    cuts.push(...result.cuts);
    for (const z of result.unresolvedZones) zones.add(z);
  }
  occurrences.sort((a, b) => codeUnit(a.start, b.start) || codeUnit(a.uid, b.uid));
  const limit = capLimit(params.limit, EVENT_LIMIT);
  return {
    from,
    to,
    clamped,
    occurrences: occurrences.slice(0, limit),
    omitted: Math.max(0, occurrences.length - limit),
    cuts,
    unresolvedZones: [...zones].sort(codeUnit),
  };
}
