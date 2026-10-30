/**
 * An in-memory CalendarBackend. It speaks the port exactly — iCalendar text in, text out — so the
 * core is tested against the same contract EDS and a later CalDAV backend fulfil.
 */

import {
  BackendError,
  ConflictError,
  readEvent,
  type CalendarBackend,
  type CalendarInfo,
  type ItemKind,
} from '@reminder/core';

export interface FakeBackend extends CalendarBackend {
  /** Every stored component, by calendar uid. */
  store: Map<string, string[]>;
  calls: string[];
  /** Change a stored item behind the core's back, as a second client would. */
  tamper(calendarUid: string, uid: string, ical: string): void;
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
  // Like a CalDAV server: one opaque revision per resource, changed by every write.
  const etags = new Map<string, string>();
  const etagKey = (calendarUid: string, uid: string) => `${calendarUid}/${uid}`;
  let revision = 0;
  const bump = (calendarUid: string, uid: string) => etags.set(etagKey(calendarUid, uid), `"r${++revision}"`);
  const find = (calendarUid: string, uid: string) => {
    const list = store.get(calendarUid);
    const index = list?.findIndex((ical) => uidOf(ical) === uid) ?? -1;
    return list && index >= 0 ? { list, index } : null;
  };

  for (const [calendarUid, list] of store) for (const ical of list) bump(calendarUid, uidOf(ical));

  return {
    id: 'fake',
    store,
    calls,
    tamper(calendarUid, uid, ical) {
      const found = find(calendarUid, uid);
      if (!found) throw new BackendError(`no ${uid} in ${calendarUid}`);
      found.list[found.index] = ical;
      bump(calendarUid, uid);
    },
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
      const found = find(calendarUid, uid);
      if (!found) return null;
      return { ical: found.list[found.index], etag: etags.get(etagKey(calendarUid, uid)) ?? null };
    },
    async createItem(calendarUid, _kind, ical) {
      calls.push(`createItem:${calendarUid}`);
      const list = store.get(calendarUid);
      if (!list) throw new BackendError(`no calendar ${calendarUid}`);
      if (list.some((existing) => uidOf(existing) === uidOf(ical))) throw new BackendError('UID exists');
      list.push(ical);
      bump(calendarUid, uidOf(ical));
      return uidOf(ical);
    },
    async updateItem(calendarUid, _kind, uid, ical, etag) {
      calls.push(`updateItem:${calendarUid}/${uid}`);
      const found = find(calendarUid, uid);
      if (!found) throw new BackendError(`no ${uid} in ${calendarUid}`);
      const current = etags.get(etagKey(calendarUid, uid)) ?? null;
      if (etag && current !== etag) throw new ConflictError(`${uid} changed on the server`, 'http', 412);
      found.list[found.index] = ical;
      bump(calendarUid, uid);
    },
  };
}

export function vevent(uid: string, lines: string[]): string {
  return ['BEGIN:VEVENT', `UID:${uid}`, ...lines, 'END:VEVENT', ''].join('\r\n');
}

export function vtodo(uid: string, lines: string[]): string {
  return ['BEGIN:VTODO', `UID:${uid}`, ...lines, 'END:VTODO', ''].join('\r\n');
}
