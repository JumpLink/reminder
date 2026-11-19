/**
 * A CalendarBackend that lives in memory: iCalendar text in, text out, with etags like a CalDAV
 * server. Demo mode runs on it, so no network, EDS or file is involved.
 */

import {
  BackendError,
  ConflictError,
  type CalendarBackend,
  type CalendarInfo,
  type ItemKind,
} from '@reminder/core';

const uidOf = (ical: string): string => /^UID:(.*)$/m.exec(ical.replace(/\r/g, ''))?.[1] ?? '';

export function createMemoryBackend(
  id: string,
  calendars: readonly CalendarInfo[],
  items: Readonly<Record<string, readonly string[]>>,
  readOnly: ReadonlySet<string> = new Set(),
): CalendarBackend {
  const store = new Map<string, string[]>(calendars.map((c) => [c.uid, [...(items[c.uid] ?? [])]]));
  const etags = new Map<string, string>();
  let revision = 0;
  const key = (calendarUid: string, uid: string) => `${calendarUid}/${uid}`;
  const bump = (calendarUid: string, uid: string) => etags.set(key(calendarUid, uid), `"r${++revision}"`);
  for (const [calendarUid, list] of store) for (const ical of list) bump(calendarUid, uidOf(ical));

  const list = (calendarUid: string): string[] => {
    const found = store.get(calendarUid);
    if (!found) throw new BackendError(`no calendar ${calendarUid}`);
    return found;
  };
  const writable = (calendarUid: string): string[] => {
    if (readOnly.has(calendarUid)) throw new BackendError(`calendar ${calendarUid} is read-only`);
    return list(calendarUid);
  };

  return {
    id,
    async listCalendars(kind?: ItemKind) {
      return calendars.filter((c) => !kind || c.kind === kind).map((c) => ({ ...c }));
    },
    async listItems(query) {
      const out = [];
      for (const c of calendars) {
        if (c.kind !== query.kind || (query.calendarUid && c.uid !== query.calendarUid)) continue;
        for (const ical of store.get(c.uid) ?? []) out.push({ calendarUid: c.uid, ical });
      }
      return out;
    },
    async getItem(calendarUid, _kind, uid) {
      const ical = list(calendarUid).find((i) => uidOf(i) === uid);
      return ical === undefined ? null : { ical, etag: etags.get(key(calendarUid, uid)) ?? null };
    },
    async createItem(calendarUid, _kind, ical) {
      const target = writable(calendarUid);
      if (target.some((i) => uidOf(i) === uidOf(ical))) throw new BackendError('UID exists');
      target.push(ical);
      bump(calendarUid, uidOf(ical));
      return uidOf(ical);
    },
    async updateItem(calendarUid, _kind, uid, ical, etag) {
      const target = writable(calendarUid);
      const index = target.findIndex((i) => uidOf(i) === uid);
      if (index < 0) throw new BackendError(`no ${uid} in ${calendarUid}`);
      if (etag && etags.get(key(calendarUid, uid)) !== etag)
        throw new ConflictError(`${uid} changed`, 'memory', 412);
      target[index] = ical;
      bump(calendarUid, uid);
    },
  };
}
