import { describe, expect, it } from '@gjsify/unit';
import { parseConfig, type SecretStore } from '@reminder/core';

import { staticContext } from '../../../src/core/context.ts';
import { createGuiSync } from '../../../src/frontends/gui/sync.ts';
import { calendar, createFakeBackend, vtodo } from '../fake-backend.ts';

const SECRET = 'hunter2-not-for-messages';

const lockedStore: SecretStore = {
  id: 'locked',
  lookup: async () => ({ status: 'unavailable', reason: 'the keyring is locked' }),
  store: async () => ({ status: 'unavailable', reason: 'locked' }),
  clear: async () => ({ status: 'unavailable', reason: 'locked' }),
};

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

export default async () => {
  await describe('gui sync with a broken account', async () => {
    const config = parseConfig({
      accounts: [
        { id: 'good', backend: 'eds' },
        {
          id: 'bad',
          backend: 'caldav',
          caldav: { url: 'https://dav.example.org/', username: 'someone', passwordSecret: 'bad:password' },
        },
      ],
    });
    const good = createFakeBackend([calendar('list', 'reminder', 'Good list')], {
      list: [vtodo('t1', ['SUMMARY:Works'])],
    });
    const context = {
      ...staticContext(good, config, { secrets: lockedStore }),
      accountBackend: (account: { id: string }) => (account.id === 'good' ? good : undefined),
    };

    await it('serves the working account and names the broken one', async () => {
      const sync = await createGuiSync(context, { REMINDER_CALDAV_PASSWORD: SECRET });
      expect(sync.backend !== null).toBe(true);
      const uids = (await sync.backend!.listCalendars()).map((c) => c.uid);
      expect(uids.join(',')).toBe('good:list');
      const items = await sync.backend!.listItems({ kind: 'reminder' });
      expect(items.map((i) => i.calendarUid).join(',')).toBe('good:list');
      expect(sync.problems.length).toBe(1);
      expect(sync.problems[0].includes('"bad"')).toBe(true);
      expect(sync.problems[0].includes('the keyring is locked')).toBe(true);
    });

    await it('leaks no secret value into a message', async () => {
      const sync = await createGuiSync(context, { REMINDER_CALDAV_PASSWORD: SECRET });
      expect(sync.problems.some((p) => p.includes(SECRET))).toBe(false);
    });

    await it('lists the calendars of a working account once at start', async () => {
      const before = good.calls.filter((c) => c.startsWith('listCalendars')).length;
      const sync = await createGuiSync(context);
      await sync.backend!.listCalendars();
      const after = good.calls.filter((c) => c.startsWith('listCalendars')).length;
      expect(after - before).toBe(1);
    });

    await it('refuses a write on the broken account without touching the good one', async () => {
      const sync = await createGuiSync(context);
      const err = await rejection(
        sync.backend!.createItem('bad:list', 'reminder', 'BEGIN:VTODO\r\nEND:VTODO\r\n'),
      );
      expect(err instanceof Error).toBe(true);
      expect(good.calls.some((c) => c.startsWith('createItem'))).toBe(false);
    });

    await it('has no backend when every account is broken', async () => {
      const only = parseConfig({
        backend: 'caldav',
        caldav: { url: 'https://dav.example.org/', username: 'someone', passwordSecret: 'bad:password' },
      });
      const sync = await createGuiSync(staticContext(good, only, { secrets: lockedStore }), {});
      expect(sync.backend === null).toBe(true);
      expect(sync.problems.length).toBe(1);
    });
  });
};
