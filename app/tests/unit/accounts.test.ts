/**
 * Several accounts in one configuration (docs/adr/0005): how the file is read, how a target names
 * an account, and that a write lands on the account its target names and on no other.
 */

import { describe, expect, it } from '@gjsify/unit';
import {
  ConfigError,
  createMultiBackend,
  createReminder,
  DEFAULT_ACCOUNT_ID,
  parseConfig,
  qualifyTarget,
  resolveAccountTarget,
  serializeConfig,
  splitTarget,
  type CalendarBackend,
} from '@reminder/core';

import { calendar, createFakeBackend, vtodo, type FakeBackend } from './fake-backend.ts';

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

const caldavAccount = {
  id: 'work',
  backend: 'caldav',
  caldav: { url: 'https://dav.example.org/', username: 'someone', passwordEnv: 'WORK_PASSWORD' },
};

function twoBackends(): { home: FakeBackend; work: FakeBackend; backend: CalendarBackend } {
  const home = createFakeBackend([calendar('list-todo', 'reminder'), calendar('cal-home', 'event')], {
    'list-todo': [vtodo('t-home', ['SUMMARY:At home'])],
  });
  const work = createFakeBackend([calendar('list-todo', 'reminder')], {
    'list-todo': [vtodo('t-work', ['SUMMARY:At work'])],
  });
  return {
    home,
    work,
    backend: createMultiBackend([
      { id: 'home', backend: home },
      { id: 'work', backend: work },
    ]),
  };
}

export default async () => {
  await describe('account targets', async () => {
    await it('splits at the first colon, so a CalDAV URL keeps its own', async () => {
      expect(splitTarget('work:https://dav.example.org/cal/1/')?.account).toBe('work');
      expect(splitTarget('work:https://dav.example.org/cal/1/')?.uid).toBe('https://dav.example.org/cal/1/');
      expect(qualifyTarget('work', 'list-1')).toBe('work:list-1');
    });

    await it('reads no account out of a bare uid or an illegal id', async () => {
      for (const target of ['list-1', 'Work:list-1', ':list-1', 'work:']) {
        expect(splitTarget(target)).toBe(null);
      }
    });

    await it('keeps a URL scheme from passing as an account', async () => {
      // `https` splits mechanically — it is kept out by being a reserved id, so no configured
      // account can ever answer to it.
      expect(splitTarget('https://dav.example.org/')?.account).toBe('https');
      expect(thrown(() => parseConfig({ accounts: [{ id: 'https' }] })) instanceof ConfigError).toBe(true);
      expect(resolveAccountTarget([{ id: 'home' }, { id: 'work' }], 'https://dav.example.org/')).toBe(null);
    });

    await it('leaves a target whole when there is exactly one account', async () => {
      const one = [{ id: 'default' }];
      expect(resolveAccountTarget(one, 'https://dav.example.org/cal/1/')?.uid).toBe(
        'https://dav.example.org/cal/1/',
      );
      expect(resolveAccountTarget(one, 'list-1')?.account).toBe('default');
    });

    await it('needs a configured account once there is more than one', async () => {
      const two = [{ id: 'home' }, { id: 'work' }];
      expect(resolveAccountTarget(two, 'home:list-1')?.uid).toBe('list-1');
      expect(resolveAccountTarget(two, 'list-1')).toBe(null);
      expect(resolveAccountTarget(two, 'other:list-1')).toBe(null);
    });
  });

  await describe('config with accounts', async () => {
    await it('reads a file without accounts as one account', async () => {
      const c = parseConfig({ backend: 'eds', defaults: { reminder: 'list-1' } });
      expect(c.accounts.length).toBe(1);
      expect(c.accounts[0].id).toBe(DEFAULT_ACCOUNT_ID);
      expect(c.accounts[0].backend).toBe('eds');
      // The spelling it was read in is the spelling it is written back in.
      const again = JSON.parse(serializeConfig(c)) as Record<string, unknown>;
      expect(again.backend).toBe('eds');
      expect('accounts' in again).toBe(false);
    });

    await it('carries the caldav section of a single-account file into its account', async () => {
      const c = parseConfig({
        backend: 'caldav',
        caldav: { url: 'https://dav.example.org/', username: 'u' },
      });
      expect(c.accounts[0].caldav?.url).toBe('https://dav.example.org/');
      expect(c.accounts[0].caldav?.passwordEnv).toBe('REMINDER_CALDAV_PASSWORD');
    });

    await it('reads accounts in file order and writes them back', async () => {
      const c = parseConfig({ accounts: [{ id: 'home', backend: 'eds' }, caldavAccount] });
      expect(c.accounts.map((a) => a.id).join(',')).toBe('home,work');
      expect(c.backend).toBe(undefined);
      expect(c.accounts[1].caldav?.passwordEnv).toBe('WORK_PASSWORD');
      const again = JSON.parse(serializeConfig(c)) as Record<string, unknown>;
      expect('backend' in again).toBe(false);
      expect((again.accounts as { id: string }[])[1].id).toBe('work');
    });

    await it('keeps unknown keys inside an account on a round trip', async () => {
      const c = parseConfig({ accounts: [{ id: 'home', backend: 'eds', future: { a: 1 } }] });
      const account = (JSON.parse(serializeConfig(c)).accounts as Record<string, unknown>[])[0];
      expect(JSON.stringify(account.future)).toBe('{"a":1}');
      expect('extra' in account).toBe(false);
    });

    await it('refuses accounts together with a top-level backend', async () => {
      const err = thrown(() => parseConfig({ accounts: [{ id: 'home' }], backend: 'eds' }));
      expect(err instanceof ConfigError).toBe(true);
    });

    await it('refuses an empty list, a duplicate id and an id that reads as a URL scheme', async () => {
      for (const accounts of [
        [],
        'home',
        [{ id: 'home' }, { id: 'home' }],
        [{ id: 'https' }, { id: 'home' }],
        [{ id: 'Home' }],
        [{ id: 'a:b' }],
        [{ id: '' }],
        [{ id: 'x'.repeat(33) }],
        ['home'],
      ]) {
        expect(thrown(() => parseConfig({ accounts })) instanceof ConfigError).toBe(true);
      }
    });

    await it('refuses an unqualified target once there is more than one account', async () => {
      const accounts = [{ id: 'home' }, caldavAccount];
      for (const rest of [
        { grants: [{ capability: 'reminder.create', target: 'list-1' }] },
        { routes: [{ concerns: ['tax'], target: 'list-1' }] },
        { defaults: { reminder: 'list-1' } },
        { priorities: { list: 'list-1' } },
        { defaults: { reminder: 'nosuch:list-1' } },
      ]) {
        expect(thrown(() => parseConfig({ accounts, ...rest })) instanceof ConfigError).toBe(true);
      }
    });

    await it('takes qualified targets, and bare ones while there is a single account', async () => {
      const two = parseConfig({
        accounts: [{ id: 'home' }, caldavAccount],
        grants: [{ capability: 'reminder.create', target: 'home:list-1' }],
        defaults: { reminder: 'home:list-1' },
        priorities: { list: 'home:list-1' },
      });
      expect(two.defaults.reminder).toBe('home:list-1');
      const one = parseConfig({ accounts: [{ id: 'home' }], defaults: { reminder: 'list-1' } });
      expect(one.defaults.reminder).toBe('list-1');
    });

    await it('takes a board grant with several accounts: its target names a board source', async () => {
      const config = parseConfig({
        accounts: [{ id: 'home' }, caldavAccount],
        grants: [{ capability: 'board.move', target: 'team-board:42' }],
      });
      expect(config.grants[0].target).toBe('team-board:42');
    });
  });

  await describe('multi backend', async () => {
    await it('merges calendars and stamps every uid with its account', async () => {
      const { backend } = twoBackends();
      const uids = (await backend.listCalendars('reminder')).map((c) => c.uid);
      expect(uids.join(',')).toBe('home:list-todo,work:list-todo');
    });

    await it('merges items without a calendar and qualifies where each came from', async () => {
      const { backend } = twoBackends();
      const items = await backend.listItems({ kind: 'reminder' });
      expect(items.map((i) => i.calendarUid).join(',')).toBe('home:list-todo,work:list-todo');
    });

    await it('asks one account only when the query names a calendar', async () => {
      const { home, work, backend } = twoBackends();
      const items = await backend.listItems({ kind: 'reminder', calendarUid: 'work:list-todo' });
      expect(items.length).toBe(1);
      expect(items[0].calendarUid).toBe('work:list-todo');
      expect(home.calls.length).toBe(0);
      expect(work.calls.length).toBe(1);
    });

    await it('reads and writes through the account its target names', async () => {
      const { home, work, backend } = twoBackends();
      expect(await backend.getItem('home:list-todo', 'reminder', 't-work')).toBe(null);
      await backend.createItem('work:list-todo', 'reminder', vtodo('t-new', ['SUMMARY:New']));
      expect(work.store.get('list-todo')?.length).toBe(2);
      expect(home.store.get('list-todo')?.length).toBe(1);
    });

    await it('refuses a target that names no account instead of guessing one', async () => {
      const { backend } = twoBackends();
      expect(await rejection(backend.getItem('list-todo', 'reminder', 't-home'))).not.toBe(null);
      expect(await rejection(backend.createItem('other:list-todo', 'reminder', vtodo('t', [])))).not.toBe(
        null,
      );
    });

    await it('lets a broken account fail the call rather than drop out of the list', async () => {
      const home = createFakeBackend([calendar('list-todo', 'reminder')]);
      const broken: CalendarBackend = {
        id: 'broken',
        listCalendars: async () => {
          throw new Error('offline');
        },
        listItems: async () => [],
        getItem: async () => null,
        createItem: async () => '',
        updateItem: async () => {},
      };
      const backend = createMultiBackend([
        { id: 'home', backend: home },
        { id: 'work', backend: broken },
      ]);
      expect(await rejection(backend.listCalendars('reminder'))).not.toBe(null);
    });
  });

  await describe('writing with several accounts', async () => {
    await it('routes a create to the granted account and leaves the other untouched', async () => {
      const { home, work, backend } = twoBackends();
      const config = parseConfig({
        accounts: [{ id: 'home' }, { id: 'work' }],
        grants: [{ capability: 'reminder.create', target: 'work:list-todo' }],
        defaults: { reminder: 'work:list-todo' },
      });
      const result = await createReminder(
        { backend, config, now: () => new Date('2026-10-10T12:00:00Z') },
        { source: 'mail', sourceId: '<m1@example.org>', summary: 'Pay it' },
      );
      expect(result.calendarUid).toBe('work:list-todo');
      expect(work.store.get('list-todo')?.length).toBe(2);
      expect(home.store.get('list-todo')?.length).toBe(1);
    });

    await it('refuses a write to an account no grant names', async () => {
      const { backend } = twoBackends();
      const config = parseConfig({
        accounts: [{ id: 'home' }, { id: 'work' }],
        grants: [{ capability: 'reminder.create', target: 'work:list-todo' }],
        defaults: { reminder: 'work:list-todo' },
      });
      const err = await rejection(
        createReminder(
          { backend, config },
          { calendar: 'home:list-todo', source: 'mail', sourceId: '<m2@example.org>', summary: 'No' },
        ),
      );
      expect(err).not.toBe(null);
    });
  });
};
