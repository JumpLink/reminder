/**
 * An in-memory CalendarBackend. It speaks the port exactly — iCalendar text in, text out — so the
 * core is tested against the same contract EDS and a later CalDAV backend fulfil.
 */

import {
  BackendError,
  readEvent,
  type CalendarBackend,
  type CalendarInfo,
  type ItemKind,
} from '@reminder/core';

export interface FakeBackend extends CalendarBackend {
  /** Every stored component, by calendar uid. */
  store: Map<string, string[]>;
  calls: string[];
}

function uidOf(ical: string): string {
  return /^UID:(.*)$/m.exec(ical.replace(/\r/g, ''))?.[1] ?? '';
}

export function calendar(uid: string, kind: ItemKind, name = uid): CalendarInfo {
  return { uid, name, kind, backend: 'fake', account: null };
}

export function createFakeBackend(
  calendars: CalendarInfo[],
  items: Record<string, string[]> = {},
): FakeBackend {
  const store = new Map<string, string[]>(calendars.map((c) => [c.uid, [...(items[c.uid] ?? [])]]));
  const calls: string[] = [];
  return {
    id: 'fake',
    store,
    calls,
    async listCalendars(kind) {
      calls.push(`listCalendars:${kind ?? '*'}`);
      return calendars.filter((c) => !kind || c.kind === kind);
    },
    async listItems(query) {
      calls.push(`listItems:${query.kind}`);
      const out = [];
      for (const c of calendars) {
        if (c.kind !== query.kind || (query.calendarUid && c.uid !== query.calendarUid)) continue;
        for (const ical of store.get(c.uid) ?? []) {
          if (query.kind === 'event' && query.from && query.to) {
            const start = readEvent(ical, c.uid)?.start ?? '';
            if (start < query.from.slice(0, start.length) || start >= query.to.slice(0, start.length))
              continue;
          }
          out.push({ calendarUid: c.uid, ical });
        }
      }
      return out;
    },
    async getItem(calendarUid, _kind, uid) {
      calls.push(`getItem:${uid}`);
      return (store.get(calendarUid) ?? []).find((ical) => uidOf(ical) === uid) ?? null;
    },
    async createItem(calendarUid, _kind, ical) {
      calls.push(`createItem:${calendarUid}`);
      const list = store.get(calendarUid);
      if (!list) throw new BackendError(`no calendar ${calendarUid}`);
      if (list.some((existing) => uidOf(existing) === uidOf(ical))) throw new BackendError('UID exists');
      list.push(ical);
      return uidOf(ical);
    },
  };
}

export function vevent(uid: string, lines: string[]): string {
  return ['BEGIN:VEVENT', `UID:${uid}`, ...lines, 'END:VEVENT', ''].join('\r\n');
}

export function vtodo(uid: string, lines: string[]): string {
  return ['BEGIN:VTODO', `UID:${uid}`, ...lines, 'END:VTODO', ''].join('\r\n');
}
