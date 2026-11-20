import { describe, expect, it } from '@gjsify/unit';
import {
  BackendUnavailableError,
  emptyConfig,
  type CalendarBackend,
  type ReminderConfig,
} from '@reminder/core';

import { staticContext } from '../../../src/core/context.ts';
import { createDemoContext } from '../../../src/core/demo/index.ts';
import { registerTools } from '../../../src/frontends/mcp/server.ts';
import { calendar, createFakeBackend, vevent, vtodo } from '../fake-backend.ts';
import { createRecorder } from './recorder.ts';

// The catalogue is the client contract. Adding a tool here is a decision (ADR 0001 §4), not a
// side effect of a refactor.
const READ_ONLY_TOOLS = [
  'boards_list',
  'calendars_list',
  'cards_list',
  'events_list',
  'priorities_list',
  'reminders_list',
];
const WRITE_TOOLS = ['events_create', 'reminders_create', 'reminders_update'];

function withGrants(...grants: ReminderConfig['grants']): ReminderConfig {
  return { ...emptyConfig(), grants };
}

export default async () => {
  const backend = createFakeBackend(
    [calendar('cal-a', 'event', 'Work'), calendar('list', 'reminder', 'Todo')],
    {
      'cal-a': [vevent('e1', ['DTSTART:20261012T080000Z', 'SUMMARY:Sync'])],
      list: [vtodo('t1', ['SUMMARY:Reply'])],
    },
  );

  await describe('MCP catalogue', async () => {
    await it('registers the read-only tools and no write tool without a grant', async () => {
      const rec = createRecorder();
      registerTools(rec.server, staticContext(backend, emptyConfig()));
      expect([...rec.names()].sort()).toEqualArray(READ_ONLY_TOOLS);
      for (const tool of rec.tools) expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(rec.names().some((n) => WRITE_TOOLS.includes(n))).toBe(false);
    });

    await it('serves only the create tool whose capability is granted', async () => {
      const eventRec = createRecorder();
      registerTools(
        eventRec.server,
        staticContext(backend, withGrants({ capability: 'calendar.create', target: 'cal-a' })),
      );
      expect([...eventRec.names()].sort()).toEqualArray([...READ_ONLY_TOOLS, 'events_create'].sort());
      expect(eventRec.tools.find((t) => t.name === 'events_create')?.annotations?.readOnlyHint).toBe(false);

      const reminderRec = createRecorder();
      registerTools(
        reminderRec.server,
        staticContext(backend, withGrants({ capability: 'reminder.create', target: 'list' })),
      );
      expect([...reminderRec.names()].sort()).toEqualArray([...READ_ONLY_TOOLS, 'reminders_create'].sort());

      // Creating and updating are separate grants: one does not bring the other's tool along.
      const updateRec = createRecorder();
      registerTools(
        updateRec.server,
        staticContext(backend, withGrants({ capability: 'reminder.update', target: 'list' })),
      );
      expect([...updateRec.names()].sort()).toEqualArray([...READ_ONLY_TOOLS, 'reminders_update'].sort());
      expect(updateRec.tools.find((t) => t.name === 'reminders_update')?.annotations?.readOnlyHint).toBe(
        false,
      );
    });

    await it('drops a tool that carries no annotation at all', async () => {
      const rec = createRecorder();
      registerTools(rec.server, staticContext(backend, emptyConfig()));
      const before = rec.names();
      // The realistic defect: an author forgets the annotation. A default-deny gate drops it; a
      // gate that only drops explicit writes would serve a tool with no guard at all.
      rec.server.registerTool(
        'canary_unannotated',
        { title: 'Unannotated canary', description: 'Must never be served', inputSchema: {} },
        async () => ({ content: [] }),
      );
      expect(rec.names()).toEqualArray(before);
    });

    await it('drops a tool that declares itself mutating but no capability', async () => {
      const rec = createRecorder();
      registerTools(rec.server, staticContext(backend, emptyConfig()));
      const before = rec.names();
      rec.server.registerTool(
        'canary_write',
        {
          title: 'Mutating canary',
          description: 'Must never be served',
          inputSchema: {},
          annotations: { readOnlyHint: false, openWorldHint: false },
        },
        async () => ({ content: [] }),
      );
      expect(rec.names()).toEqualArray(before);
    });
  });

  await describe('MCP write tools', async () => {
    const config = withGrants(
      { capability: 'calendar.create', target: 'cal-a' },
      { capability: 'reminder.create', target: 'list' },
    );

    await it('creates an event exactly once per source key', async () => {
      const store = createFakeBackend([calendar('cal-a', 'event', 'Work')]);
      const rec = createRecorder();
      registerTools(rec.server, staticContext(store, config));

      const input = {
        calendar: 'cal-a',
        source: 'mail',
        sourceId: '<m1@example.org>',
        summary: 'Sync',
        start: '2026-10-12T08:00:00Z',
      };
      const first = JSON.parse((await rec.call('events_create', input)).content[0].text);
      expect(first.created).toBe(true);
      expect(first.calendarUid).toBe('cal-a');
      expect(first.source).toBe('mail:<m1@example.org>');
      expect(store.store.get('cal-a')?.length).toBe(1);

      const again = JSON.parse((await rec.call('events_create', input)).content[0].text);
      expect(again.created).toBe(false);
      expect(again.uid).toBe(first.uid);
      expect(store.store.get('cal-a')?.length).toBe(1);
    });

    await it('creates a reminder with a due date', async () => {
      const store = createFakeBackend([calendar('list', 'reminder', 'Todo')]);
      const rec = createRecorder();
      registerTools(rec.server, staticContext(store, config));

      const res = JSON.parse(
        (
          await rec.call('reminders_create', {
            calendar: 'list',
            source: 'letter',
            sourceId: '2026-10-30-1',
            summary: 'Answer the letter',
            due: '2026-11-06',
          })
        ).content[0].text,
      );
      expect(res.created).toBe(true);
      expect(store.store.get('list')?.[0]).toContain('SUMMARY:Answer the letter');
    });

    await it('routes a concern to a granted target', async () => {
      const store = createFakeBackend([calendar('cal-a', 'event', 'Work')]);
      const routed: ReminderConfig = {
        ...config,
        routes: [{ concerns: ['school'], kind: 'event', target: 'cal-a' }],
      };
      const rec = createRecorder();
      registerTools(rec.server, staticContext(store, routed));
      const res = JSON.parse(
        (
          await rec.call('events_create', {
            concern: 'school',
            source: 'mail',
            sourceId: '<m2@example.org>',
            summary: 'Parents evening',
            start: '2026-11-02',
          })
        ).content[0].text,
      );
      expect(res.created).toBe(true);
      expect(res.calendarUid).toBe('cal-a');
    });

    await it('refuses a call whose target is not granted, without writing', async () => {
      const store = createFakeBackend([
        calendar('cal-a', 'event', 'Work'),
        calendar('cal-b', 'event', 'Private'),
      ]);
      const rec = createRecorder();
      registerTools(rec.server, staticContext(store, config));
      const res = await rec.call('events_create', {
        calendar: 'cal-b',
        source: 'mail',
        sourceId: '<m3@example.org>',
        summary: 'Sync',
        start: '2026-10-12',
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('calendar.create');
      expect(store.calls.some((c) => c.startsWith('createItem:'))).toBe(false);
    });

    await it('refuses a call that resolves no target at all', async () => {
      const store = createFakeBackend([calendar('cal-a', 'event', 'Work')]);
      const rec = createRecorder();
      registerTools(rec.server, staticContext(store, config));
      const res = await rec.call('events_create', {
        source: 'mail',
        sourceId: '<m4@example.org>',
        summary: 'Sync',
        start: '2026-10-12',
      });
      expect(res.isError).toBe(true);
      expect(store.calls.some((c) => c.startsWith('createItem:'))).toBe(false);
    });

    await it('turns a core refusal into an error result', async () => {
      const store = createFakeBackend([calendar('cal-a', 'event', 'Work')]);
      const rec = createRecorder();
      registerTools(rec.server, staticContext(store, config));
      const res = await rec.call('events_create', {
        calendar: 'cal-a',
        source: 'mail',
        sourceId: '<m5@example.org>',
        summary: '   ',
        start: '2026-10-12',
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('summary');
    });
  });

  await describe('MCP reminders_update', async () => {
    const config = withGrants(
      { capability: 'reminder.update', target: 'list' },
      { capability: 'reminder.update', target: 'other' },
    );

    const open = (uid: string) =>
      createFakeBackend([calendar('list', 'reminder', 'Todo'), calendar('other', 'reminder', 'Other')], {
        list: [vtodo(uid, ['SUMMARY:Reply', 'DUE;VALUE=DATE:20261112', 'DESCRIPTION:Ask about the form'])],
      });

    await it('changes only the fields it is given and clears with null', async () => {
      const store = open('t1');
      const rec = createRecorder();
      registerTools(rec.server, staticContext(store, config));
      const res = JSON.parse(
        (await rec.call('reminders_update', { calendar: 'list', uid: 't1', due: null, priority: 2 }))
          .content[0].text,
      );
      expect(res.reminder.due).toBe(null);
      expect(res.reminder.priority).toBe(2);
      expect(res.reminder.summary).toBe('Reply');
      expect(res.reminder.description).toBe('Ask about the form');
    });

    await it('completes a task and reopens it', async () => {
      const store = open('t1');
      const rec = createRecorder();
      registerTools(rec.server, staticContext(store, config));
      const done = JSON.parse(
        (await rec.call('reminders_update', { uid: 't1', calendar: 'list', status: 'completed' })).content[0]
          .text,
      );
      expect(done.reminder.status).toBe('completed');
      const again = JSON.parse(
        (await rec.call('reminders_update', { uid: 't1', calendar: 'list', status: 'needs-action' }))
          .content[0].text,
      );
      expect(again.reminder.status).toBe('needs-action');
      expect(again.reminder.completed).toBe(null);
    });

    await it('refuses an empty change set and an unknown uid, without writing', async () => {
      const store = open('t1');
      const rec = createRecorder();
      registerTools(rec.server, staticContext(store, config));
      expect((await rec.call('reminders_update', { calendar: 'list', uid: 't1' })).isError).toBe(true);
      expect(
        (await rec.call('reminders_update', { calendar: 'list', uid: 'ghost', summary: 'x' })).isError,
      ).toBe(true);
      expect(store.calls.some((c) => c.startsWith('updateItem:'))).toBe(false);
    });

    await it('refuses a list no grant names, without reading it', async () => {
      const store = open('t1');
      const rec = createRecorder();
      registerTools(
        rec.server,
        staticContext(store, withGrants({ capability: 'reminder.update', target: 'list' })),
      );
      const res = await rec.call('reminders_update', { calendar: 'other', uid: 't1', summary: 'No' });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('reminder.update');
      expect(store.calls.some((c) => c.startsWith('getItem:'))).toBe(false);
    });
  });

  await describe('MCP tool results', async () => {
    const rec = createRecorder();
    registerTools(rec.server, staticContext(backend, emptyConfig()));

    await it('calendars_list answers from the backend', async () => {
      const res = await rec.call('calendars_list', { kind: 'event' });
      const payload = JSON.parse(res.content[0].text) as { count: number; calendars: { uid: string }[] };
      expect(payload.count).toBe(1);
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

    await it('events_list returns the series by default and instances with expand', async () => {
      const series = createFakeBackend([calendar('cal-r', 'event', 'Work')], {
        'cal-r': [vevent('r1', ['DTSTART:20261012T080000Z', 'SUMMARY:Stand-up', 'RRULE:FREQ=DAILY'])],
      });
      const r = createRecorder();
      registerTools(r.server, staticContext(series, emptyConfig()));
      const window = { from: '2026-10-12', to: '2026-10-14' };
      const plain = JSON.parse((await r.call('events_list', window)).content[0].text);
      expect('p' + plain.events.length).toBe('p1');
      expect(plain.occurrences === undefined).toBe(true);
      const expanded = JSON.parse((await r.call('events_list', { ...window, expand: true })).content[0].text);
      expect(expanded.occurrences.length + ':' + expanded.omitted).toBe('3:0');
      expect(expanded.events === undefined).toBe(true);
      expect(expanded.omitted).toBe(0);
      const capped = JSON.parse(
        (await r.call('events_list', { ...window, expand: true, limit: 2 })).content[0].text,
      );
      expect(capped.occurrences.length + ':' + capped.omitted).toBe('2:1');
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

  await describe('MCP board tools', async () => {
    const demo = () => {
      const rec = createRecorder();
      registerTools(rec.server, createDemoContext(new Date(2026, 10, 18, 9, 0)));
      return rec;
    };

    await it('boards_list answers the demo boards, capped with an omitted count', async () => {
      const all = JSON.parse((await demo().call('boards_list')).content[0].text);
      expect(all.boards.some((b: { id: string }) => b.id === 'relaunch')).toBe(true);
      expect(all.omitted).toBe(0);
      const one = JSON.parse((await demo().call('boards_list', { limit: 1 })).content[0].text);
      expect(one.boards.length).toBe(1);
      expect(one.omitted).toBe(all.boards.length - 1);
    });

    await it('cards_list returns lanes without descriptions and reports what the cap cut', async () => {
      const res = await demo().call('cards_list', { board: 'relaunch', mine: 'all', limit: 2 });
      const payload = JSON.parse(res.content[0].text);
      expect(payload.cards.length).toBe(2);
      expect(payload.omitted > 0).toBe(true);
      expect(Object.keys(payload.cards[0]).sort().join(',')).toBe('assignees,column,due,id,lane,title,url');
    });

    await it('cards_list refuses an unknown board with an error result', async () => {
      const res = await demo().call('cards_list', { board: 'nope' });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain('nope');
    });

    await it('serves a hidden-but-enabled list to agents and never a disabled one', async () => {
      const lists = createFakeBackend([calendar('shown', 'reminder'), calendar('off', 'reminder')], {
        shown: [vtodo('a', ['SUMMARY:Reply'])],
        off: [vtodo('b', ['SUMMARY:Secret'])],
      });
      const enabled = createRecorder();
      registerTools(enabled.server, staticContext(lists, emptyConfig()));
      const both = JSON.parse((await enabled.call('boards_list')).content[0].text);
      expect(
        both.boards
          .map((b: { id: string }) => b.id)
          .sort()
          .join(','),
      ).toBe('off,shown');

      const disabled = createRecorder();
      registerTools(disabled.server, staticContext(lists, { ...emptyConfig(), disabled: ['off'] }));
      const left = JSON.parse((await disabled.call('boards_list')).content[0].text);
      expect(left.boards.map((b: { id: string }) => b.id).join(',')).toBe('shown');
      expect((await disabled.call('cards_list', { board: 'off' })).isError).toBe(true);
    });
  });
};
