/**
 * iCalendar (RFC 5545) — the subset reminder reads and writes, pure.
 *
 * Every backend hands over text, so this is the one place that knows the grammar: unfolding,
 * parameter quoting, TEXT escaping, DATE vs DATE-TIME, and turning a TZID into an instant.
 */

import { InputError } from './errors.ts';
import type { EventItem, ReminderItem, ReminderStatus } from './types.ts';
import { _, fmt } from './i18n.ts';

/** The property a created item carries its dedupe key in. */
export const SOURCE_PROPERTY = 'X-REMINDER-SOURCE';

export interface ContentLine {
  name: string;
  params: Record<string, string>;
  value: string;
}

export interface Component {
  name: string;
  props: ContentLine[];
  children: Component[];
}

/** Undo RFC 5545 §3.1 line folding: a CRLF followed by one space or tab is not a break. */
export function unfold(text: string): string[] {
  return text
    .replace(/\r?\n[ \t]/g, '')
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

/** Split one content line; a quoted parameter value may contain `:` and `;`. */
export function parseContentLine(line: string): ContentLine {
  let i = 0;
  let quoted = false;
  let nameEnd = -1;
  let valueStart = -1;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ';' && nameEnd < 0) nameEnd = i;
    else if (!quoted && ch === ':') {
      valueStart = i + 1;
      if (nameEnd < 0) nameEnd = i;
      break;
    }
  }
  if (valueStart < 0) throw new InputError(fmt(_('not an iCalendar content line: {line}'), { line: line.slice(0, 40) }));
  const name = line.slice(0, nameEnd).toUpperCase();
  const params: Record<string, string> = {};
  const paramText = line.slice(nameEnd, valueStart - 1);
  for (const match of paramText.matchAll(/;([^=;:]+)=("([^"]*)"|[^;:]*)/g)) {
    params[match[1].toUpperCase()] = match[3] ?? match[2];
  }
  return { name, params, value: line.slice(valueStart) };
}

/** Parse iCalendar text into its component tree. A bare VEVENT (as EDS returns it) is fine. */
export function parseComponents(text: string): Component[] {
  const roots: Component[] = [];
  const stack: Component[] = [];
  for (const raw of unfold(text)) {
    const line = parseContentLine(raw);
    if (line.name === 'BEGIN') {
      const comp: Component = { name: line.value.toUpperCase(), props: [], children: [] };
      (stack.at(-1)?.children ?? roots).push(comp);
      stack.push(comp);
    } else if (line.name === 'END') {
      stack.pop();
    } else {
      stack.at(-1)?.props.push(line);
    }
  }
  return roots;
}

/** First component with that name, depth-first; nested VALARMs are never what we want. */
export function findComponent(roots: Component[], name: string): Component | null {
  for (const comp of roots) {
    if (comp.name === name) return comp;
    const inner = findComponent(comp.children, name);
    if (inner) return inner;
  }
  return null;
}

export function unescapeText(value: string): string {
  return value.replace(/\\([nN\\;,])/g, (_m, ch: string) => (ch === 'n' || ch === 'N' ? '\n' : ch));
}

export function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold to 75 octets per line (RFC 5545 §3.1), never inside a UTF-8 sequence. */
export function fold(line: string): string {
  const out: string[] = [];
  let current = '';
  let octets = 0;
  for (const ch of line) {
    const size = utf8Length(ch);
    const limit = out.length === 0 ? 75 : 74;
    if (octets + size > limit) {
      out.push(current);
      current = '';
      octets = 0;
    }
    current += ch;
    octets += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

function utf8Length(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp < 0x80) return 1;
  if (cp < 0x800) return 2;
  if (cp < 0x10000) return 3;
  return 4;
}

// ── time ───────────────────────────────────────────────────────────────────

export interface ParsedTime {
  iso: string;
  allDay: boolean;
  /** The TZID parameter, verbatim. */
  tzid: string | null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** Offset of `zone` from UTC at instant `ms`, in ms; null when the zone is unknown here. */
function zoneOffset(ms: number, zone: string): number | null {
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    return null;
  }
  const parts: Record<string, number> = {};
  for (const part of format.formatToParts(new Date(ms))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - ms;
}

/**
 * IANA candidates for a TZID. Evolution writes libical's own prefix
 * (`/freeassociation.sourceforge.net/Europe/Berlin`, sometimes with `Tzfile/`); the zone name
 * is what follows it.
 */
function zoneCandidates(tzid: string): string[] {
  const stripped = tzid.replace(/^\/[^/]+\/(Tzfile\/)?/, '');
  return stripped === tzid ? [tzid] : [tzid, stripped];
}

/** Wall-clock time in `tzid` → UTC ms, or null when no candidate zone is known. */
export function zonedToUtc(wall: number, tzid: string): number | null {
  for (const zone of zoneCandidates(tzid)) {
    const first = zoneOffset(wall, zone);
    if (first === null) continue;
    // Two passes: the offset at the guessed instant can differ across a DST switch.
    const second = zoneOffset(wall - first, zone);
    return wall - (second ?? first);
  }
  return null;
}

/** Parse a DATE or DATE-TIME property value. */
export function parseTime(line: ContentLine): ParsedTime {
  const value = line.value.trim();
  const tzid = line.params.TZID ?? null;
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date) return { iso: `${date[1]}-${date[2]}-${date[3]}`, allDay: true, tzid };

  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!m) throw new InputError(fmt(_('invalid iCalendar time: {value}'), { value }));
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const floating = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
  if (m[7] === 'Z') return { iso: `${floating}Z`, allDay: false, tzid: null };
  if (tzid) {
    const utc = zonedToUtc(wall, tzid);
    if (utc !== null) return { iso: new Date(utc).toISOString().replace('.000Z', 'Z'), allDay: false, tzid };
  }
  return { iso: floating, allDay: false, tzid };
}

/** Caller input → iCalendar value: `YYYY-MM-DD` stays a DATE, anything else becomes UTC. */
export function formatInputTime(input: string): { value: string; allDay: boolean } {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const ms = Date.parse(`${input}T00:00:00Z`);
    if (Number.isNaN(ms)) throw new InputError(fmt(_('invalid date: {value}'), { value: input }));
    return { value: input.replace(/-/g, ''), allDay: true };
  }
  // A time without an offset is refused rather than read in the zone this process happens to run
  // in — the same input would mean different instants on two machines.
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(input)) {
    throw new InputError(fmt(_('time needs an offset or Z, or use a bare YYYY-MM-DD: {value}'), { value: input }));
  }
  const ms = Date.parse(input);
  if (Number.isNaN(ms)) throw new InputError(fmt(_('invalid time: {value}'), { value: input }));
  return { value: formatUtc(new Date(ms)), allDay: false };
}

export function formatUtc(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

// ── reading ────────────────────────────────────────────────────────────────

function prop(comp: Component, name: string): ContentLine | undefined {
  return comp.props.find((p) => p.name === name);
}

function text(comp: Component, name: string): string | null {
  const line = prop(comp, name);
  return line ? unescapeText(line.value) || null : null;
}

function address(value: string | undefined): string | null {
  if (!value) return null;
  return value.replace(/^mailto:/i, '') || null;
}

function integer(comp: Component, name: string): number | null {
  const line = prop(comp, name);
  if (!line) return null;
  const n = Number.parseInt(line.value, 10);
  return Number.isFinite(n) ? n : null;
}

/** A time property that may be malformed in the wild: unreadable is "unknown", not a failed read. */
function lenientTime(line: ContentLine | undefined): string | null {
  if (!line) return null;
  try {
    return parseTime(line).iso;
  } catch {
    return null;
  }
}

/** RFC 5545: an absent RELTYPE means PARENT. */
function parentUid(comp: Component): string | null {
  const link = comp.props.find(
    (p) => p.name === 'RELATED-TO' && (p.params.RELTYPE ?? 'PARENT').toUpperCase() === 'PARENT',
  );
  return link?.value.trim() || null;
}

/** A VEVENT as an EventItem; null when it has no usable DTSTART. */
export function readEvent(ical: string, calendarUid: string): EventItem | null {
  const comp = findComponent(parseComponents(ical), 'VEVENT');
  if (!comp) return null;
  const dtstart = prop(comp, 'DTSTART');
  if (!dtstart) return null;
  const start = parseTime(dtstart);
  const dtend = prop(comp, 'DTEND');
  return {
    uid: prop(comp, 'UID')?.value ?? '',
    calendarUid,
    summary: text(comp, 'SUMMARY'),
    description: text(comp, 'DESCRIPTION'),
    location: text(comp, 'LOCATION'),
    start: start.iso,
    end: dtend ? parseTime(dtend).iso : null,
    allDay: start.allDay,
    timezone: start.tzid,
    recurring: prop(comp, 'RRULE') !== undefined,
    organizer: address(prop(comp, 'ORGANIZER')?.value),
    attendees: comp.props
      .filter((p) => p.name === 'ATTENDEE')
      .map((p) => address(p.value))
      .filter((a): a is string => a !== null),
    source: prop(comp, SOURCE_PROPERTY)?.value ?? null,
  };
}

const STATUS: Record<string, ReminderStatus> = {
  'NEEDS-ACTION': 'needs-action',
  'IN-PROCESS': 'in-process',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

/** A VTODO as a ReminderItem; null when the text holds none. */
export function readReminder(ical: string, calendarUid: string): ReminderItem | null {
  const comp = findComponent(parseComponents(ical), 'VTODO');
  if (!comp) return null;
  const due = prop(comp, 'DUE');
  const dueTime = due ? parseTime(due) : null;
  const completed = prop(comp, 'COMPLETED');
  const statusValue = prop(comp, 'STATUS')?.value.toUpperCase();
  // A COMPLETED stamp without a STATUS still means done; some clients write only the stamp.
  const status = statusValue ? (STATUS[statusValue] ?? 'unknown') : completed ? 'completed' : 'needs-action';
  const priority = integer(comp, 'PRIORITY');
  return {
    uid: prop(comp, 'UID')?.value ?? '',
    calendarUid,
    summary: text(comp, 'SUMMARY'),
    description: text(comp, 'DESCRIPTION'),
    due: dueTime?.iso ?? null,
    dueAllDay: dueTime?.allDay ?? false,
    completed: completed ? parseTime(completed).iso : null,
    status,
    priority: priority === null || priority === 0 ? null : priority,
    percentComplete: integer(comp, 'PERCENT-COMPLETE'),
    recurring: prop(comp, 'RRULE') !== undefined,
    source: prop(comp, SOURCE_PROPERTY)?.value ?? null,
    created: lenientTime(prop(comp, 'CREATED')) ?? lenientTime(prop(comp, 'DTSTAMP')),
    url: prop(comp, 'URL')?.value.trim() || null,
    parent: parentUid(comp),
  };
}

// ── writing ────────────────────────────────────────────────────────────────

export interface EventFields {
  uid: string;
  source: string;
  summary: string;
  start: string;
  end?: string;
  description?: string;
  location?: string;
}

export interface ReminderFields {
  uid: string;
  source: string;
  summary: string;
  due?: string;
  description?: string;
}

/** `DUE:20260101T090000Z` or `DUE;VALUE=DATE:20260101`, from caller input. */
export function timeLine(name: string, input: string): string {
  const { value, allDay } = formatInputTime(input);
  return allDay ? `${name};VALUE=DATE:${value}` : `${name}:${value}`;
}

function serialize(name: string, lines: string[]): string {
  return [`BEGIN:${name}`, ...lines, `END:${name}`].map(fold).join('\r\n') + '\r\n';
}

function textLine(name: string, value: string | undefined): string[] {
  return value ? [`${name}:${escapeText(value)}`] : [];
}

/** A VEVENT as iCalendar text. The source key goes into `X-REMINDER-SOURCE`. */
export function buildEvent(fields: EventFields, now: Date): string {
  const start = formatInputTime(fields.start);
  if (fields.end && formatInputTime(fields.end).allDay !== start.allDay) {
    throw new InputError(_('start and end must both be dates or both be times'));
  }
  return serialize('VEVENT', [
    `UID:${fields.uid}`,
    `DTSTAMP:${formatUtc(now)}`,
    timeLine('DTSTART', fields.start),
    ...(fields.end ? [timeLine('DTEND', fields.end)] : []),
    `SUMMARY:${escapeText(fields.summary)}`,
    ...textLine('DESCRIPTION', fields.description),
    ...textLine('LOCATION', fields.location),
    `${SOURCE_PROPERTY}:${fields.source}`,
  ]);
}

/** A VTODO as iCalendar text, status NEEDS-ACTION. */
export function buildReminder(fields: ReminderFields, now: Date): string {
  return serialize('VTODO', [
    `UID:${fields.uid}`,
    `DTSTAMP:${formatUtc(now)}`,
    ...(fields.due ? [timeLine('DUE', fields.due)] : []),
    `SUMMARY:${escapeText(fields.summary)}`,
    ...textLine('DESCRIPTION', fields.description),
    'STATUS:NEEDS-ACTION',
    `${SOURCE_PROPERTY}:${fields.source}`,
  ]);
}
