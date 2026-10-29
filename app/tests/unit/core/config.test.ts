import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';
import { ConfigError, parseConfig, serializeConfig } from '@reminder/core';

import { configPath, loadConfig } from '../../../src/core/config.ts';

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

export default async () => {
  await describe('config model', async () => {
    await it('defaults to eds with nothing granted', async () => {
      const c = parseConfig({});
      expect(c.backend).toBe('eds');
      expect(c.grants).toEqualArray([]);
    });

    await it('refuses an unknown backend and a non-object', async () => {
      expect(thrown(() => parseConfig({ backend: 'webcal' })) instanceof ConfigError).toBe(true);
      expect(thrown(() => parseConfig([])) instanceof ConfigError).toBe(true);
    });

    await it('reads priorities.list, defaults to none, and refuses a malformed section', async () => {
      expect(parseConfig({}).priorities.list).toBe(undefined);
      expect(parseConfig({ priorities: { list: 'list-1' } }).priorities.list).toBe('list-1');
      const again = JSON.parse(serializeConfig(parseConfig({ priorities: { list: 'list-1' } })));
      expect(again.priorities.list).toBe('list-1');
      for (const bad of [[], 'x', { list: '' }, { list: 3 }]) {
        expect(thrown(() => parseConfig({ priorities: bad })) instanceof ConfigError).toBe(true);
      }
    });

    await it('keeps unknown keys on a round trip', async () => {
      const c = parseConfig({ future: { a: 1 }, grants: [{ capability: 'calendar.create', target: 'c' }] });
      const again = JSON.parse(serializeConfig(c)) as Record<string, unknown>;
      expect(JSON.stringify(again.future)).toBe('{"a":1}');
      expect((again.grants as unknown[]).length).toBe(1);
      expect('extra' in again).toBe(false);
    });
  });

  await describe('config file', async () => {
    await it('resolves REMINDER_CONFIG, then XDG_CONFIG_HOME, then ~/.config', async () => {
      expect(configPath({ REMINDER_CONFIG: '/x/c.json' })).toBe('/x/c.json');
      expect(configPath({ XDG_CONFIG_HOME: '/xdg' })).toBe('/xdg/reminder/config.json');
      expect(configPath({ HOME: '/home/someone' })).toBe('/home/someone/.config/reminder/config.json');
    });

    const dir = mkdtempSync(join(tmpdir(), 'reminder-config-'));
    try {
      await it('treats a missing file as empty', async () => {
        expect(loadConfig(join(dir, 'missing.json')).grants).toEqualArray([]);
      });

      await it('fails loudly on invalid JSON instead of falling back to empty', async () => {
        const path = join(dir, 'broken.json');
        writeFileSync(path, '{ "grants": [');
        const err = thrown(() => loadConfig(path));
        expect(err instanceof ConfigError).toBe(true);
        expect((err as Error).message).toContain(path);
      });

      await it('reads a valid file', async () => {
        const path = join(dir, 'ok.json');
        writeFileSync(path, JSON.stringify({ defaults: { reminder: 'list-1' } }));
        expect(loadConfig(path).defaults.reminder).toBe('list-1');
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
};
