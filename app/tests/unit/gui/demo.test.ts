import { describe, expect, it } from '@gjsify/unit';
import {
  AGENDA_SECTIONS,
  buildAgenda,
  isGranted,
  readReminder,
  updateReminder,
  type ReminderItem,
} from '@reminder/core';
import { existsSync } from 'node:fs';

import { createDemoContext, DEMO_LISTS } from '../../../src/core/demo/index.ts';
import { createGuiSync } from '../../../src/frontends/gui/sync.ts';

const NOW = new Date(2026, 10, 18, 9, 0);

async function reminders(context = createDemoContext(NOW)): Promise<ReminderItem[]> {
  const raw = await context.backend().listItems({ kind: 'reminder' });
  return raw.map((r) => readReminder(r.ical, r.calendarUid)).filter((r): r is ReminderItem => r !== null);
}

export default async () => {
  await describe('demo mode', async () => {
    await it('fills every agenda section for a fixed now', async () => {
      const agenda = buildAgenda(await reminders(), NOW);
      const ids = agenda.sections.map((s) => s.id).join(',');
      expect(ids).toBe(AGENDA_SECTIONS.join(','));
      expect(agenda.completed.length > 0).toBe(true);
    });

    await it('has four lists on two accounts, two of them named alike', async () => {
      const calendars = await createDemoContext(NOW).backend().listCalendars();
      expect(calendars.length).toBe(4);
      expect(calendars.filter((c) => c.name === 'Tasks').length).toBe(2);
      expect(new Set(calendars.map((c) => c.account)).size).toBe(2);
    });

    await it('grants every list but the read-only one', async () => {
      const config = createDemoContext(NOW).config();
      for (const list of DEMO_LISTS) {
        expect(isGranted(config.grants, 'reminder.update', `${list.account}:${list.uid}`)).toBe(
          !list.readOnly,
        );
      }
    });

    await it('writes in memory', async () => {
      const context = createDemoContext(NOW);
      const before = (await reminders(context)).find((r) => r.uid === 'demo-d01');
      const result = await updateReminder(
        { backend: context.backend(), config: context.config(), now: () => NOW },
        { calendar: 'home:tasks', uid: 'demo-d01', status: 'completed' },
      );
      expect(before?.status).toBe('needs-action');
      expect(result.reminder?.status).toBe('completed');
      expect((await reminders(context)).find((r) => r.uid === 'demo-d01')?.status).toBe('completed');
    });

    await it('starts the sync service with no network, no config file and no secret store', async () => {
      const path = `/tmp/reminder-demo-test-${process.pid}/config.json`;
      const env = process.env.REMINDER_CONFIG;
      process.env.REMINDER_CONFIG = path;
      const realFetch = globalThis.fetch;
      let fetched = 0;
      globalThis.fetch = (async () => {
        fetched++;
        throw new Error('demo mode must not use the network');
      }) as typeof fetch;
      try {
        const context = createDemoContext(NOW);
        const sync = await createGuiSync(context, {});
        await sync.service.start();
        sync.service.stop();
        expect(sync.problems.length).toBe(0);
        expect(sync.backend !== null).toBe(true);
        expect(fetched).toBe(0);
        expect(existsSync(path)).toBe(false);
      } finally {
        globalThis.fetch = realFetch;
        if (env === undefined) delete process.env.REMINDER_CONFIG;
        else process.env.REMINDER_CONFIG = env;
      }
    });
  });
};
