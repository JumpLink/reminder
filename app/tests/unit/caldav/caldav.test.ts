import { describe, expect, it } from '@gjsify/unit';
import {
  BackendAuthError,
  BackendError,
  ConfigError,
  UnsupportedAuthError,
  parseConfig,
} from '@reminder/core';
import { createCaldavBackend } from '@reminder/caldav';

import { createBackend } from '../../../src/core/context.ts';
import { startFakeDav } from './fake-dav-server.ts';

const USER = 'user@example.org';
const PASSWORD = 'not-a-real-password';

const wrap = (inner: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${inner}END:VCALENDAR\r\n`;
const SINGLE = wrap(
  'BEGIN:VEVENT\r\nUID:single\r\nDTSTART:20261012T080000Z\r\nSUMMARY:One\r\nEND:VEVENT\r\n',
);
const SERIES = wrap(
  'BEGIN:VEVENT\r\nUID:series\r\nDTSTART:20260105T090000Z\r\nRRULE:FREQ=WEEKLY\r\nSUMMARY:Weekly\r\nEND:VEVENT\r\n',
);
const TODO = wrap('BEGIN:VTODO\r\nUID:todo\r\nSUMMARY:Task\r\nEND:VTODO\r\n');

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

async function withServer(fn: (dav: Awaited<ReturnType<typeof startFakeDav>>) => Promise<void>) {
  const dav = await startFakeDav({
    user: USER,
    password: PASSWORD,
    resources: {
      '/cal/events/single.ics': SINGLE,
      '/cal/events/series.ics': SERIES,
      '/cal/tasks/todo.ics': TODO,
    },
  });
  try {
    await fn(dav);
  } finally {
    await dav.close();
  }
}

export default async () => {
  await describe('caldav backend', async () => {
    await it('discovers collections and sorts them into events and reminders', async () => {
      await withServer(async (dav) => {
        const b = createCaldavBackend({ url: dav.url, username: USER, password: PASSWORD });
        const events = await b.listCalendars('event');
        expect(events.length).toBe(1);
        expect(events[0].name).toBe('Events');
        expect(events[0].kind).toBe('event');
        expect(events[0].backend).toBe('caldav');
        const tasks = await b.listCalendars('reminder');
        expect(tasks.map((c) => c.name).join()).toBe('Tasks');
        expect((await b.listCalendars()).length).toBe(2);
      });
    });

    await it('queries a range and returns a recurring series as its definition', async () => {
      await withServer(async (dav) => {
        const b = createCaldavBackend({ url: dav.url, username: USER, password: PASSWORD });
        const items = await b.listItems({
          kind: 'event',
          from: '2026-10-01T00:00:00Z',
          to: '2026-11-01T00:00:00Z',
        });
        expect(items.length).toBe(2);
        expect(items.some((i) => i.ical.includes('RRULE:FREQ=WEEKLY'))).toBe(true);
        const report = dav.requests.find((r) => r.method === 'REPORT' && r.body.includes('calendar-query'));
        expect(report?.body.includes('start="20261001T000000Z"')).toBe(true);
        expect(report?.body.includes('end="20261101T000000Z"')).toBe(true);
        const tasks = await b.listItems({ kind: 'reminder' });
        expect(tasks.length).toBe(1);
      });
    });

    await it('finds an item by uid, or null', async () => {
      await withServer(async (dav) => {
        const b = createCaldavBackend({ url: dav.url, username: USER, password: PASSWORD });
        const [cal] = await b.listCalendars('event');
        expect((await b.getItem(cal.uid, 'event', 'single'))?.includes('UID:single')).toBe(true);
        expect(await b.getItem(cal.uid, 'event', 'missing')).toBe(null);
      });
    });

    await it('creates a wrapped component with If-None-Match and refuses a duplicate', async () => {
      await withServer(async (dav) => {
        const b = createCaldavBackend({ url: dav.url, username: USER, password: PASSWORD });
        const [cal] = await b.listCalendars('event');
        const bare = 'BEGIN:VEVENT\r\nUID:new-1\r\nDTSTART:20261020T100000Z\r\nSUMMARY:New\r\nEND:VEVENT\r\n';
        expect(await b.createItem(cal.uid, 'event', bare)).toBe('new-1');
        const stored = dav.resources.get('/cal/events/new-1.ics') ?? '';
        expect(stored.startsWith('BEGIN:VCALENDAR')).toBe(true);
        expect(stored.includes('UID:new-1')).toBe(true);
        expect(dav.requests.find((r) => r.method === 'PUT')?.ifNoneMatch).toBe('*');
        expect((await rejection(b.createItem(cal.uid, 'event', bare))) instanceof BackendError).toBe(true);
      });
    });

    await it('maps a rejected password to BackendAuthError', async () => {
      await withServer(async (dav) => {
        const b = createCaldavBackend({ url: dav.url, username: USER, password: 'wrong' });
        const err = await rejection(b.listCalendars());
        expect(err instanceof BackendAuthError).toBe(true);
        expect((err as BackendAuthError).code).toBe(401);
      });
    });
  });

  await describe('caldav config and factory', async () => {
    const base = { backend: 'caldav', caldav: { url: 'https://dav.example.org/', username: 'u' } };

    await it('parses with the default password variable', () => {
      const c = parseConfig(base);
      expect(c.caldav?.passwordEnv).toBe('REMINDER_CALDAV_PASSWORD');
      expect(c.caldav?.auth).toBe('basic');
    });

    await it('refuses a password in the file and a missing section', () => {
      const bad = (raw: unknown) => {
        try {
          parseConfig(raw);
        } catch (err) {
          return err instanceof ConfigError;
        }
        return false;
      };
      expect(bad({ backend: 'caldav' })).toBe(true);
      expect(bad({ backend: 'caldav', caldav: { ...base.caldav, password: 'x' } })).toBe(true);
      expect(bad({ backend: 'caldav', caldav: { url: 'ftp://x', username: 'u' } })).toBe(true);
    });

    await it('answers oauth2 with UnsupportedAuthError, and a missing variable with ConfigError', () => {
      const oauth = parseConfig({
        backend: 'caldav',
        caldav: { url: 'https://dav.example.org/', auth: 'oauth2' },
      });
      let err: unknown = null;
      try {
        createBackend(oauth, {});
      } catch (e) {
        err = e;
      }
      expect(err instanceof UnsupportedAuthError).toBe(true);
      try {
        createBackend(parseConfig(base), {});
      } catch (e) {
        err = e;
      }
      expect(err instanceof ConfigError).toBe(true);
      expect(createBackend(parseConfig(base), { REMINDER_CALDAV_PASSWORD: 'x' }).id).toBe('caldav');
    });
  });
};
