import { describe, expect, it } from '@gjsify/unit';
import {
  createMemoryCacheStore,
  createSyncService,
  encodeCollectionBody,
  parseConfig,
  type CacheKey,
  type SyncFetch,
} from '@reminder/core';

import { createTasksModel, tomorrow } from '../../../src/frontends/gui/model.ts';
import { buildSyncSources } from '../../../src/frontends/gui/sync-sources.ts';
import { calendar, createFakeBackend, vtodo } from '../fake-backend.ts';

const NOW = new Date(2026, 10, 18, 9, 0);

async function settle(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !condition(); i++) await Promise.resolve();
}

function setup(grants: { capability: string; target: string }[]) {
  const lists = [calendar('work', 'reminder', 'Work'), calendar('home', 'reminder', 'Home')];
  const backend = createFakeBackend(lists, {
    work: [vtodo('w1', ['SUMMARY:Send report', 'DUE;VALUE=DATE:20261117', 'STATUS:NEEDS-ACTION'])],
    home: [vtodo('h1', ['SUMMARY:Water plants', 'STATUS:NEEDS-ACTION'])],
  });
  const config = parseConfig({ backend: 'eds', grants });
  const cache = createMemoryCacheStore();
  const fetchList: SyncFetch = async (key: CacheKey) => {
    const raw = await backend.listItems({ kind: 'reminder', calendarUid: key.source });
    return {
      kind: 'changed',
      body: encodeCollectionBody(raw.map((r, i) => ({ href: String(i), etag: null, ical: r.ical }))),
      version: null,
    };
  };
  const sources = buildSyncSources(config, [{ account: 'default', calendars: lists }]);
  const service = createSyncService({
    cache,
    fetch: fetchList,
    clock: { now: () => NOW.getTime() },
    scheduler: { setTimeout: () => 0, clearTimeout: () => undefined },
    sources,
  });
  const model = createTasksModel({ config, backend, service, now: () => NOW });
  return { backend, service, model, sources };
}

export default async () => {
  await describe('sync sources', async () => {
    await it('has one source per enabled task list and leaves disabled ones out', async () => {
      const lists = [calendar('a', 'reminder'), calendar('b', 'reminder'), calendar('e', 'event')];
      const config = parseConfig({ backend: 'eds', disabled: ['b'] });
      const sources = buildSyncSources(config, [{ account: 'default', calendars: lists }]);
      expect(sources.map((s) => s.key.source).join(',')).toBe('a');
      expect(sources[0].kind).toBe('eds');
    });
  });

  await describe('tasks model', async () => {
    await it('fills from the sync service and reports each source as current', async () => {
      const { model, service } = setup([]);
      await model.load();
      await service.start();
      await settle(() => model.reminders().length === 2);
      expect(
        model
          .reminders()
          .map((r) => r.uid)
          .sort()
          .join(','),
      ).toBe('h1,w1');
      expect(model.reminders().find((r) => r.uid === 'w1')?.calendarUid).toBe('work');
      expect(model.syncStatus().every((s) => s.status?.state.kind === 'current')).toBe(true);
    });

    await it('refuses to write without a grant and leaves the store untouched', async () => {
      const { model, service, backend } = setup([]);
      await model.load();
      await service.start();
      await settle(() => model.reminders().length === 2);
      const item = model.reminders().find((r) => r.uid === 'w1');
      expect(model.writable('work')).toBe(false);
      const outcome = await model.setDone(item as never, true);
      expect(outcome.kind).toBe('denied');
      expect(backend.calls.some((c) => c.startsWith('updateItem'))).toBe(false);
    });

    await it('completes and reopens where a grant names the list', async () => {
      const { model, service } = setup([{ capability: 'reminder.update', target: 'work' }]);
      await model.load();
      await service.start();
      await settle(() => model.reminders().length === 2);
      expect(model.writable('work')).toBe(true);
      expect(model.writable('home')).toBe(false);
      const item = model.reminders().find((r) => r.uid === 'w1');
      expect((await model.setDone(item as never, true)).kind).toBe('ok');
      const done = model.reminders().find((r) => r.uid === 'w1');
      expect(done?.status).toBe('completed');
      expect((await model.setDone(done as never, false)).kind).toBe('ok');
      expect(model.reminders().find((r) => r.uid === 'w1')?.status).toBe('needs-action');
    });

    await it('postpones to tomorrow as a bare date', async () => {
      const { model, service } = setup([{ capability: 'reminder.update', target: 'work' }]);
      await model.load();
      await service.start();
      await settle(() => model.reminders().length === 2);
      const item = model.reminders().find((r) => r.uid === 'w1');
      expect((await model.postpone(item as never)).kind).toBe('ok');
      expect(model.reminders().find((r) => r.uid === 'w1')?.due).toBe('2026-11-19');
      expect(tomorrow(new Date(2026, 11, 31))).toBe('2027-01-01');
    });

    await it('reports a change made elsewhere as a conflict, not a failure', async () => {
      const { model, service, backend } = setup([{ capability: 'reminder.update', target: 'work' }]);
      await model.load();
      await service.start();
      await settle(() => model.reminders().length === 2);
      const item = model.reminders().find((r) => r.uid === 'w1');
      // Another client edits between the read and our write: the etag no longer matches.
      const original = backend.getItem.bind(backend);
      backend.getItem = async (c, k, u) => {
        const stored = await original(c, k, u);
        backend.tamper('work', 'w1', vtodo('w1', ['SUMMARY:Edited elsewhere']));
        return stored;
      };
      expect((await model.setDone(item as never, true)).kind).toBe('conflict');
    });
  });
};
