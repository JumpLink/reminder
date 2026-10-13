import { describe, expect, it } from '@gjsify/unit';
import {
  BackendUnavailableError,
  emptyConfig,
  type CalendarBackend,
  type Grant,
  type ReminderConfig,
} from '@reminder/core';

import { staticContext } from '../../../src/core/context.ts';
import { registerTools } from '../../../src/frontends/mcp/server.ts';
import { calendar, createFakeBackend, vevent, vtodo } from '../fake-backend.ts';
import { createRecorder } from './recorder.ts';

// The catalogue is the client contract. A write tool appearing here is a decision for an ADR,
// not a side effect of a refactor.
const READ_ONLY_TOOLS = ['calendars_list', 'events_list', 'priorities_list', 'reminders_list'];
const WRITE_TOOLS = ['events_create', 'reminders_create'];

const grantedConfig = (grants: Grant[]): ReminderConfig => ({
  ...emptyConfig(),
  grants,
  routes: [{ concerns: ['school'], kind: 'event', target: 'cal-b' }],
  defaults: { event: 'cal-a', reminder: 'list' },
});

const EVENT = {
  summary: 'Parents evening',
  start: '2026-10-20T18:00:00Z',
  source: 'mail',
  sourceId: '<id-1@example.org>',
};

export default async () => {
  const backend = createFakeBackend(
    [
      calendar('cal-a', 'event', 'Work'),
      calendar('cal-b', 'event', 'Family'),
      calendar('list', 'reminder', 'Todo'),
    ],
    {
      'cal-a': [vevent('e1', ['DTSTART:20261012T080000Z', 'SUMMARY:Sync'])],
      list: [vtodo('t1', ['SUMMARY:Reply'])],
    },
  );

  await describe('MCP catalogue', async () => {
    await it('registers exactly the read-only tools', async () => {
      const rec = createRecorder();
      registerTools(rec.server, staticContext(backend, emptyConfig()));
      expect([...rec.names()].sort()).toEqualArray(READ_ONLY_TOOLS);
      for (const tool of rec.tools) expect(tool.annotations?.readOnlyHint).toBe(true);
    });

    await it('exposes no create tool without a grant', async () => {
      const rec = createRecorder();
      registerTools(rec.server, staticContext(backend, emptyConfig()));
      expect(rec.names().some((n) => /create|add|write|save/.test(n))).toBe(false);
    });

    await it('registers only the create tool whose capability is granted', async () => {
      const rec = createRecorder();
      registerTools(
        rec.server,
        staticContext(backend, grantedConfig([{ capability: 'calendar.create', target: 'cal-a' }])),
      );
      expect([...rec.names()].sort()).toEqualArray([...READ_ONLY_TOOLS, 'events_create'].sort());
      const both = createRecorder();
      registerTools(
        both.server,
        staticContext(
          backend,
          grantedConfig([
            { capability: 'calendar.create', target: 'cal-a' },
            { capability: 'reminder.create', target: 'list' },
          ]),
        ),
      );
      expect([...both.names()].sort()).toEqualArray([...READ_ONLY_TOOLS, ...WRITE_TOOLS].sort());
    });
  });

  await describe('MCP tool results', async () => {
    const rec = createRecorder();
    registerTools(rec.server, staticContext(backend, emptyConfig()));

    await it('calendars_list answers from the backend', async () => {
      const res = await rec.call('calendars_list', { kind: 'event' });
      const payload = JSON.parse(res.content[0].text) as { count: number; calendars: { uid: string }[] };
      expect(payload.count).toBe(2);
      expect(payload.calendars[0].uid).toBe('cal-a');
    });

    await it('events_list and reminders_list answer through the core', async () => {
      const events = JSON.parse(
        (await rec.call('events_list', { from: '2026-10-12', to: '2026-10-12' })).content[0].text,
      );
      expect(events.events.length).toBe(1);
      const reminders = JSON.parse((await rec.call('reminders_list')).content[0].text);
      expect(reminders.reminders[0].summary).toBe('Reply');
    });

    await it('priorities_list ranks the configured list, and says so when none is configured', async () => {
      const withList = createFakeBackend([calendar('prio', 'reminder')], {
        prio: [
          vtodo('p1', ['SUMMARY:Renew the lease', 'PRIORITY:1', 'URL:https://wiki.example.org/lease']),
          vtodo('s1', ['SUMMARY:Call', 'RELATED-TO;RELTYPE=PARENT:p1', 'CREATED:20261001T100000Z']),
        ],
      });
      const configured = createRecorder();
      registerTools(
        configured.server,
        staticContext(withList, { ...emptyConfig(), priorities: { list: 'prio' } }),
      );
      const ok = JSON.parse((await configured.call('priorities_list')).content[0].text);
      expect(ok.priorities[0].uid).toBe('p1');
      expect(ok.priorities[0].link).toBe('https://wiki.example.org/lease');
      expect(ok.priorities[0].steps[0].nag).toBe(true);

      const unconfigured = createRecorder();
      registerTools(unconfigured.server, staticContext(withList, emptyConfig()));
      const res = await unconfigured.call('priorities_list');
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('priorities');
    });

    await it('turns a backend failure into an error result with a message', async () => {
      const down: CalendarBackend = {
        ...backend,
        listCalendars: async () => {
          throw new BackendUnavailableError('ECal typelib not available: missing');
        },
      };
      const failing = createRecorder();
      registerTools(failing.server, staticContext(down, emptyConfig()));
      const res = await failing.call('calendars_list');
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('typelib not available');
    });
  });

  await describe('MCP create tools', async () => {
    const setup = (grants: Grant[]) => {
      const fresh = createFakeBackend([
        calendar('cal-a', 'event'),
        calendar('cal-b', 'event'),
        calendar('list', 'reminder'),
      ]);
      const rec = createRecorder();
      registerTools(rec.server, staticContext(fresh, grantedConfig(grants)));
      return { fresh, rec };
    };
    const stored = (b: { store: Map<string, string[]> }, uid: string) => b.store.get(uid)?.length ?? 0;

    await it('is denied for an event tool without its capability', async () => {
      const { rec } = setup([{ capability: 'reminder.create', target: 'list' }]);
      expect(rec.names().includes('events_create')).toBe(false);
    });

    await it('is denied for a calendar other than the granted one', async () => {
      const { fresh, rec } = setup([{ capability: 'calendar.create', target: 'cal-a' }]);
      const res = await rec.call('events_create', { ...EVENT, calendar: 'cal-b' });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('calendar.create');
      expect(stored(fresh, 'cal-a') + stored(fresh, 'cal-b')).toBe(0);
    });

    await it('is denied when a route leads to an ungranted calendar', async () => {
      const { fresh, rec } = setup([{ capability: 'calendar.create', target: 'cal-a' }]);
      const res = await rec.call('events_create', { ...EVENT, concern: 'school' });
      expect(res.isError).toBe(true);
      expect(stored(fresh, 'cal-b')).toBe(0);
    });

    await it('is refused, not guessed, when no target resolves', async () => {
      const fresh = createFakeBackend([calendar('cal-a', 'event')]);
      const rec = createRecorder();
      registerTools(
        rec.server,
        staticContext(fresh, {
          ...emptyConfig(),
          grants: [{ capability: 'calendar.create', target: 'cal-a' }],
        }),
      );
      const res = await rec.call('events_create', EVENT);
      expect(res.isError).toBe(true);
      expect(stored(fresh, 'cal-a')).toBe(0);
    });

    await it('creates in the exactly granted calendar', async () => {
      const { fresh, rec } = setup([{ capability: 'calendar.create', target: 'cal-a' }]);
      const res = await rec.call('events_create', { ...EVENT, calendar: 'cal-a' });
      expect(res.isError).toBeFalsy();
      const payload = JSON.parse(res.content[0].text) as { status: string; uid: string; calendarUid: string };
      expect(payload.status).toBe('created');
      expect(payload.calendarUid).toBe('cal-a');
      expect(stored(fresh, 'cal-a')).toBe(1);
    });

    await it('routes by default when no calendar is given', async () => {
      const { fresh, rec } = setup([{ capability: 'calendar.create', target: 'cal-a' }]);
      const res = await rec.call('events_create', EVENT);
      expect(res.isError).toBeFalsy();
      expect(stored(fresh, 'cal-a')).toBe(1);
    });

    await it('answers already-exists with the same uid on the second call', async () => {
      const { fresh, rec } = setup([{ capability: 'calendar.create', target: 'cal-a' }]);
      const first = JSON.parse((await rec.call('events_create', EVENT)).content[0].text) as { uid: string };
      const second = JSON.parse((await rec.call('events_create', EVENT)).content[0].text) as {
        status: string;
        uid: string;
      };
      expect(second.status).toBe('already-exists');
      expect(second.uid).toBe(first.uid);
      expect(stored(fresh, 'cal-a')).toBe(1);
    });

    await it('creates a reminder in a granted task list', async () => {
      const { fresh, rec } = setup([{ capability: 'reminder.create', target: 'list' }]);
      const res = await rec.call('reminders_create', {
        summary: 'Reply',
        due: '2026-10-25',
        source: 'mail',
        sourceId: '<id-2@example.org>',
      });
      expect(res.isError).toBeFalsy();
      expect(stored(fresh, 'list')).toBe(1);
    });
  });
};
