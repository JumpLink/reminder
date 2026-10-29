/**
 * The CalDAV driver for the CalendarBackend port.
 *
 * A calendar's uid is its collection URL. Components cross the port as iCalendar text: reads hand
 * back whatever the server stores (a VCALENDAR wrapper included — core's parser walks nested
 * components), writes wrap the bare component core builds, because CalDAV stores whole VCALENDARs.
 *
 * Recurring items come back as their series definition, like EDS: the server filters by the
 * window and nothing is expanded here.
 */

import { DavClient, DavError, basicAuth, type Collection, type FetchLike } from '@gjsify/dav';

import {
  BackendAuthError,
  BackendError,
  errorMessage,
  type CalendarBackend,
  type CalendarInfo,
  type ItemKind,
  type ItemQuery,
  type RawItem,
} from '@reminder/core';

const COMPONENT: Record<ItemKind, string> = { event: 'VEVENT', reminder: 'VTODO' };
/** Multiget URLs per request, to keep request bodies bounded on large calendars. */
const MULTIGET_CHUNK = 50;

export interface CaldavOptions {
  /** Server root or any URL the user knows; RFC 6764 discovery finds the calendar home. */
  url: string;
  username: string;
  password: string;
  /** Injectable for tests and custom TLS setups; defaults to the runtime's fetch. */
  fetch?: FetchLike;
}

/** UID of a component, from unfolded text. The one line the port lets a backend look at. */
function uidOf(ical: string): string | null {
  const m = /^UID[;:][^\r\n]*$/m.exec(ical.replace(/\r?\n[ \t]/g, ''));
  const value = m?.[0].slice(m[0].indexOf(':') + 1).trim();
  return value ? value : null;
}

function wrap(ical: string): string {
  if (/^BEGIN:VCALENDAR/m.test(ical)) return ical;
  const body = ical.replace(/\r?\n/g, '\r\n');
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//reminder//CalDAV//EN\r\n${body.endsWith('\r\n') ? body : `${body}\r\n`}END:VCALENDAR\r\n`;
}

function icalUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function supports(c: Collection, kind: ItemKind): boolean {
  // A server that names no component set accepts all of them (RFC 4791 §5.2.3).
  return c.components.length === 0 || c.components.includes(COMPONENT[kind]);
}

/** Classify a failure; 401 is an auth error, everything else a BackendError naming the call. */
function davError(label: string, err: unknown): Error {
  if (err instanceof BackendError) return err;
  if (err instanceof DavError) {
    if (err.status === 401) return new BackendAuthError(`${label}: the server rejected the credentials (401)`, 'http', 401);
    return new BackendError(`${label}: ${err.method} failed with ${err.status}`, 'http', err.status);
  }
  return new BackendError(`${label}: ${errorMessage(err)}`);
}

export function createCaldavBackend(options: CaldavOptions): CalendarBackend {
  const dav = new DavClient({ auth: basicAuth(options.username, options.password), fetch: options.fetch });
  let collections: Promise<Collection[]> | null = null;

  async function boundary<T>(label: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw davError(label, err);
    }
  }

  function load(): Promise<Collection[]> {
    if (!collections) {
      collections = (async () => {
        const { homeUrl } = await dav.discover('caldav', options.url);
        return dav.listCollections(homeUrl, 'caldav');
      })();
      // A failed discovery must not be cached: the network or the password may be fixed a moment later.
      collections.catch(() => (collections = null));
    }
    return collections;
  }

  async function collection(kind: ItemKind, uid: string): Promise<Collection> {
    const found = (await load()).find((c) => c.url === uid && supports(c, kind));
    if (!found) throw new BackendError(`no ${kind === 'event' ? 'calendar' : 'task list'} "${uid}"`);
    return found;
  }

  async function fetchData(c: Collection, urls: string[]): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < urls.length; i += MULTIGET_CHUNK) {
      for (const o of await dav.getObjects(c.url, 'caldav', urls.slice(i, i + MULTIGET_CHUNK)))
        if (o.data) out.push(o.data);
    }
    return out;
  }

  const resourceUrl = (c: Collection, uid: string) =>
    `${c.url.replace(/\/$/, '')}/${encodeURIComponent(uid)}.ics`;

  return {
    id: 'caldav',

    listCalendars: (kind) =>
      boundary('listCalendars', async () => {
        const kinds: ItemKind[] = kind ? [kind] : ['event', 'reminder'];
        const account = new URL(options.url).host;
        const out: CalendarInfo[] = [];
        for (const k of kinds) {
          for (const c of await load()) {
            if (!supports(c, k)) continue;
            out.push({ uid: c.url, name: c.displayName ?? c.url, kind: k, backend: 'caldav', account });
          }
        }
        return out;
      }),

    listItems: (q: ItemQuery) =>
      boundary('listItems', async () => {
        const range =
          q.kind === 'event' && q.from && q.to ? { start: icalUtc(q.from), end: icalUtc(q.to) } : undefined;
        const items: RawItem[] = [];
        for (const c of await load()) {
          if (!supports(c, q.kind) || (q.calendarUid && c.url !== q.calendarUid)) continue;
          const listed = await dav.listObjects(c.url, 'caldav', { component: COMPONENT[q.kind], range });
          for (const ical of await fetchData(c, listed.map((o) => o.url)))
            items.push({ calendarUid: c.url, ical });
        }
        return items;
      }),

    getItem: (calendarUid, kind, uid) =>
      boundary('getItem', async () => {
        const c = await collection(kind, calendarUid);
        // Our own creates live at <uid>.ics, so ask there first; other clients name resources
        // freely, so a miss falls back to a scan. @gjsify/dav has no UID filter for calendar-query.
        const direct = (await fetchData(c, [resourceUrl(c, uid)])).find((t) => uidOf(t) === uid);
        if (direct) return direct;
        const listed = await dav.listObjects(c.url, 'caldav', { component: COMPONENT[kind] });
        return (await fetchData(c, listed.map((o) => o.url))).find((t) => uidOf(t) === uid) ?? null;
      }),

    createItem: (calendarUid, kind, ical) =>
      boundary('createItem', async () => {
        const c = await collection(kind, calendarUid);
        const uid = uidOf(ical);
        if (!uid) throw new BackendError('createItem: the component has no UID');
        try {
          await dav.put(resourceUrl(c, uid), wrap(ical), { ifNoneMatch: true });
        } catch (err) {
          if (err instanceof DavError && err.isPreconditionFailed)
            throw new BackendError(`createItem: "${uid}" already exists in "${calendarUid}"`, 'http', 412);
          if (err instanceof DavError && err.status === 403)
            throw new BackendError(`createItem: "${calendarUid}" refused the write (read-only?)`, 'http', 403);
          throw err;
        }
        return uid;
      }),
  };
}
