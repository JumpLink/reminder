import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';
import { parseConfig, setSourceEnabled, type ReminderConfig } from '@reminder/core';

import {
  accountIdFor,
  caldavAccount,
  createConfigStore,
  edsAccount,
  withAccount,
  withGrant,
  withoutAccount,
  withoutGrant,
  withDisabled,
  writeConfig,
} from '../../../src/core/config-write.ts';
import { loadConfig } from '../../../src/core/config.ts';

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'reminder-cfg-'));
}

const BASE = {
  future: { a: 1 },
  accounts: [
    { id: 'home', backend: 'eds', note: 'kept' },
    { id: 'work', backend: 'eds' },
  ],
  grants: [{ capability: 'reminder.update', target: 'home:list-1' }],
  disabled: ['work:list-9'],
};

export default async () => {
  await describe('config writer', async () => {
    await it('round-trips a modified config and keeps unknown keys', async () => {
      const dir = tmp();
      try {
        const path = join(dir, 'config.json');
        let config = parseConfig(BASE);
        const disabled = await setSourceEnabled(config.accounts, config.disabled, 'home:list-2', false);
        config = withDisabled(config, disabled);
        config = withGrant(config, { capability: 'reminder.create', target: 'home:list-1' });
        config = withoutGrant(config, { capability: 'reminder.update', target: 'home:list-1' });
        writeConfig(path, config);
        const again = loadConfig(path);
        expect(again.disabled).toEqualArray(['work:list-9', 'home:list-2']);
        expect(again.grants.length).toBe(1);
        expect(again.grants[0].capability).toBe('reminder.create');
        expect(JSON.stringify(again.extra.future)).toBe('{"a":1}');
        expect(again.accounts[0].extra.note).toBe('kept');
        expect(readdirSync(dir).join(',')).toBe('config.json');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    await it('re-enabling removes the entry and a duplicate grant is not added twice', async () => {
      let config = parseConfig(BASE);
      config = withDisabled(
        config,
        await setSourceEnabled(config.accounts, config.disabled, 'work:list-9', true),
      );
      expect(config.disabled.length).toBe(0);
      const grant = { capability: 'reminder.create', target: 'home:l' } as const;
      expect(withGrant(withGrant(config, grant), grant).grants.length).toBe(2);
    });

    await it('moves between the one-account and the accounts spelling', async () => {
      const one = parseConfig({
        grants: [{ capability: 'reminder.update', target: 'list-1' }],
        disabled: ['list-2'],
      });
      const two = withAccount(one, edsAccount('second'));
      expect(two.backend).toBe(undefined);
      expect(two.grants[0].target).toBe('default:list-1');
      expect(two.disabled[0]).toBe('default:list-2');
      const back = withoutAccount(two, 'second');
      expect(back.grants[0].target).toBe('list-1');
      expect(back.disabled[0]).toBe('list-2');
      const dir = tmp();
      try {
        const path = join(dir, 'c.json');
        writeConfig(path, two);
        expect(loadConfig(path).accounts.length).toBe(2);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    await it('removing an account drops what names it and refuses the last one', async () => {
      const config = parseConfig(BASE);
      const next = withoutAccount(config, 'work');
      expect(next.accounts.length).toBe(1);
      expect(next.disabled.length).toBe(0);
      expect(next.grants[0].target).toBe('list-1');
      expect(thrown(() => withoutAccount(next, 'home')) !== null).toBe(true);
      expect(thrown(() => withoutAccount(config, 'nope')) !== null).toBe(true);
    });

    await it('adds a CalDAV account without a password in the file', async () => {
      const dir = tmp();
      try {
        const path = join(dir, 'c.json');
        const config = withAccount(
          parseConfig(BASE),
          caldavAccount('dav', { url: 'https://dav.example.org/', username: 'amy' }),
        );
        writeConfig(path, config);
        const text = readFileSync(path, 'utf8');
        expect(text).toContain('"passwordSecret": "dav:password"');
        expect(text).not.toContain('passwordEnv');
        expect(text.toLowerCase()).not.toContain('"password"');
        expect(loadConfig(path).accounts[2].caldav?.username).toBe('amy');
        expect(thrown(() => withAccount(config, edsAccount('dav'))) !== null).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    await it('refuses to write a config that would not load, leaving the file alone', async () => {
      const dir = tmp();
      try {
        const path = join(dir, 'c.json');
        writeConfig(path, parseConfig(BASE));
        const before = readFileSync(path, 'utf8');
        const broken: ReminderConfig = {
          ...parseConfig(BASE),
          grants: [{ capability: 'reminder.create', target: 'bare' }],
        };
        expect(thrown(() => writeConfig(path, broken)) !== null).toBe(true);
        expect(readFileSync(path, 'utf8')).toBe(before);
        expect(readdirSync(dir).length).toBe(1);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    await it('makes legal, unique account ids', async () => {
      expect(accountIdFor('Büro Mail', [])).toBe('buro-mail');
      expect(accountIdFor('Büro Mail', ['buro-mail'])).toBe('buro-mail-2');
      expect(accountIdFor('???', [])).toBe('account');
      expect(accountIdFor('http', [])).toBe('http-account');
    });

    await it('demo mode keeps changes in memory and writes nothing', async () => {
      const dir = tmp();
      try {
        const path = join(dir, 'config.json');
        const store = createConfigStore({ demo: true, path, demoConfig: () => parseConfig(BASE) });
        expect(store.persistent).toBe(false);
        store.save(withGrant(store.read(), { capability: 'reminder.create', target: 'home:x' }));
        expect(store.read().grants.length).toBe(2);
        expect(existsSync(path)).toBe(false);
        expect(readdirSync(dir).length).toBe(0);
        const real = createConfigStore({ demo: false, path, demoConfig: () => parseConfig(BASE) });
        expect(real.persistent).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
};
