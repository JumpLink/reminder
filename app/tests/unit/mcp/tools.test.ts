import { describe, expect, it } from '@gjsify/unit';
import { BackendUnavailableError, emptyConfig, type CalendarBackend } from '@reminder/core';

import { staticContext } from '../../../src/core/context.ts';
import { registerTools } from '../../../src/frontends/mcp/server.ts';
import { calendar, createFakeBackend, vevent, vtodo } from '../fake-backend.ts';
import { createRecorder } from './recorder.ts';

// The catalogue is the client contract. A write tool appearing here is a decision for an ADR,
// not a side effect of a refactor.
const READ_ONLY_TOOLS = ['calendars_list', 'events_list', 'priorities_list', 'reminders_list'];

export default async () => {
  const backend = createFakeBackend(
    [calendar('cal-a', 'event', 'Work'), calendar('list', 'reminder', 'Todo')],
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

    await it('exposes no create tool', async () => {
      const rec = createRecorder();
      registerTools(rec.server, staticContext(backend, emptyConfig()));
      expect(rec.names().some((n) => /create|add|write|save/.test(n))).toBe(false);
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
};
