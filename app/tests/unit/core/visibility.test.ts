import { describe, expect, it } from '@gjsify/unit';
import {
  ConfigError,
  createMemoryCacheStore,
  createMultiBackend,
  guardDisabledCache,
  listEvents,
  listReminders,
  parseConfig,
  ReminderError,
  serializeConfig,
  setSourceEnabled,
  withoutDisabled,
  type CacheEntry,
} from '@reminder/core';

import { calendar, createFakeBackend, vevent, vtodo } from '../fake-backend.ts';

const NOW = new Date('2026-10-10T09:00:00Z');
const entry: CacheEntry = { body: 'x', version: null, fetchedAt: '2026-10-10T09:00:00Z' };

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

function fixture() {
  return createFakeBackend(
    [
      calendar('on', 'event'),
      calendar('off', 'event'),
      calendar('list-on', 'reminder'),
      calendar('list-off', 'reminder'),
    ],
    {
      on: [vevent('a', ['DTSTART:20261012T080000Z', 'SUMMARY:A'])],
      off: [vevent('b', ['DTSTART:20261012T090000Z', 'SUMMARY:B'])],
      'list-on': [vtodo('t1', ['SUMMARY:T1'])],
      'list-off': [vtodo('t2', ['SUMMARY:T2'])],
    },
  );
}

export default async () => {
  await describe('disabled sources (ADR 0006)', async () => {
    await it('parses, dedupes, round-trips and omits an empty list on save', async () => {
      expect(parseConfig({}).disabled).toEqualArray([]);
      expect(parseConfig({ disabled: ['x', 'x', 'y'] }).disabled).toEqualArray(['x', 'y']);
      expect('disabled' in JSON.parse(serializeConfig(parseConfig({})))).toBe(false);
      expect(JSON.parse(serializeConfig(parseConfig({ disabled: ['x'] }))).disabled).toEqualArray(['x']);
      for (const bad of ['x', [''], [3], {}]) {
        expect(thrown(() => parseConfig({ disabled: bad })) instanceof ConfigError).toBe(true);
      }
    });

    await it('requires the qualified spelling with several accounts', async () => {
      const accounts = [
        { id: 'home', backend: 'eds' },
        { id: 'work', backend: 'eds' },
      ];
      expect(thrown(() => parseConfig({ accounts, disabled: ['cal'] })) instanceof ConfigError).toBe(true);
      expect(parseConfig({ accounts, disabled: ['work:cal'] }).disabled).toEqualArray(['work:cal']);
    });

    await it('never lists or queries a disabled calendar', async () => {
      const inner = fixture();
      const backend = withoutDisabled(inner, ['off', 'list-off']);
      expect((await backend.listCalendars()).map((c) => c.uid)).toEqualArray(['on', 'list-on']);
      inner.calls.length = 0;
      const events = await listEvents(backend, {}, NOW);
      const reminders = await listReminders(backend);
      expect(events.events.map((e) => e.uid)).toEqualArray(['a']);
      expect(reminders.reminders.map((r) => r.uid)).toEqualArray(['t1']);
      // Every item read named an enabled calendar; none was an all-calendars read the driver could
      // have answered with disabled data.
      expect(inner.calls.filter((c) => c.startsWith('listItems')).length).toBe(2);
      expect(inner.queried).toEqualArray(['on', 'list-on']);
    });

    await it('refuses every call that names a disabled calendar before the backend sees it', async () => {
      const inner = fixture();
      const backend = withoutDisabled(inner, ['off']);
      inner.calls.length = 0;
      const attempts = [
        backend.listItems({ kind: 'event', calendarUid: 'off' }),
        backend.getItem('off', 'event', 'b'),
        backend.createItem('off', 'event', vevent('c', ['DTSTART:20261012T100000Z'])),
        backend.updateItem('off', 'event', 'b', vevent('b', ['DTSTART:20261012T100000Z']), null),
      ];
      for (const attempt of attempts) expect((await rejection(attempt)) instanceof ReminderError).toBe(true);
      expect(inner.calls).toEqualArray([]);
    });

    await it('is the inner backend itself when nothing is disabled', async () => {
      const inner = fixture();
      expect(withoutDisabled(inner, []) === inner).toBe(true);
    });

    await it('works on qualified uids behind the multiplexer', async () => {
      const home = createFakeBackend([calendar('cal', 'event')], {
        cal: [vevent('h', ['DTSTART:20261012T080000Z'])],
      });
      const work = createFakeBackend([calendar('cal', 'event')], {
        cal: [vevent('w', ['DTSTART:20261012T080000Z'])],
      });
      const backend = withoutDisabled(
        createMultiBackend([
          { id: 'home', backend: home },
          { id: 'work', backend: work },
        ]),
        ['work:cal'],
      );
      expect((await listEvents(backend, {}, NOW)).events.map((e) => e.uid)).toEqualArray(['h']);
      expect(work.calls.filter((c) => c.startsWith('listItems')).length).toBe(0);
    });

    await it('keeps no cache entry for a disabled source', async () => {
      const store = createMemoryCacheStore();
      const cache = guardDisabledCache(store, [{ id: 'default' }], ['off']);
      await cache.put({ account: 'default', source: 'off' }, entry);
      await cache.put({ account: 'default', source: 'on' }, entry);
      expect(store.entries().map((e) => e.key.source)).toEqualArray(['on']);
      expect(await cache.get({ account: 'default', source: 'off' })).toBe(null);
    });

    await it('clears the cache on disable, and repeating either direction is harmless', async () => {
      const accounts = [{ id: 'home' }, { id: 'work' }];
      const store = createMemoryCacheStore();
      await store.put({ account: 'work', source: 'cal' }, entry);
      await store.put({ account: 'home', source: 'cal' }, entry);
      let disabled = await setSourceEnabled(accounts, [], 'work:cal', false, store);
      disabled = await setSourceEnabled(accounts, disabled, 'work:cal', false, store);
      expect(disabled).toEqualArray(['work:cal']);
      expect(store.entries().map((e) => e.key.account)).toEqualArray(['home']);
      disabled = await setSourceEnabled(accounts, disabled, 'work:cal', true, store);
      disabled = await setSourceEnabled(accounts, disabled, 'work:cal', true, store);
      expect(disabled).toEqualArray([]);
    });
  });
};
