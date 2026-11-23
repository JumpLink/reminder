import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';

import {
  createGuiSettings,
  createMemorySettings,
  parseColorScheme,
  parseHidden,
  parseWeekNumbers,
  parseWeekStart,
  settingsPath,
} from '../../../src/frontends/gui/settings.ts';

export default async () => {
  await describe('gui settings', async () => {
    await it('treats missing, damaged and foreign content as nothing hidden', async () => {
      expect(parseHidden('').size).toBe(0);
      expect(parseHidden('{').size).toBe(0);
      expect(parseHidden('null').size).toBe(0);
      expect(parseHidden('{"hidden":"x"}').size).toBe(0);
      expect([...parseHidden('{"hidden":["a",1,"b"]}')].join(',')).toBe('a,b');
    });

    await it('keeps the file next to the config', async () => {
      expect(settingsPath({ XDG_CONFIG_HOME: '/x' })).toBe('/x/reminder/gui.json');
    });

    await it('persists a hidden source across instances', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'reminder-gui-'));
      try {
        const path = join(dir, 'nested', 'gui.json');
        const first = createGuiSettings(path);
        expect(first.hidden().size).toBe(0);
        first.setHidden('list-b', true);
        first.setHidden('list-a', true);
        first.setHidden('list-b', false);
        expect([...createGuiSettings(path).hidden()].join(',')).toBe('list-a');
        expect(readFileSync(path, 'utf8').includes('list-a')).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    await it('survives a file it cannot parse', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'reminder-gui-'));
      try {
        const path = join(dir, 'gui.json');
        writeFileSync(path, 'not json');
        expect(createGuiSettings(path).hidden().size).toBe(0);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    await it('keeps the colour scheme, the week start and unknown keys across instances', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'reminder-gui-'));
      try {
        const path = join(dir, 'gui.json');
        writeFileSync(path, '{"future":{"a":1},"hidden":["x"]}');
        const first = createGuiSettings(path);
        expect(first.colorScheme()).toBe('system');
        first.setColorScheme('dark');
        first.setWeekStart('monday');
        expect(first.weekNumbers()).toBe(false);
        first.setWeekNumbers(true);
        const again = createGuiSettings(path);
        expect(again.colorScheme()).toBe('dark');
        expect(again.weekStart()).toBe('monday');
        expect(again.weekNumbers()).toBe(true);
        expect(parseWeekNumbers('{"weekNumbers":"yes"}')).toBe(false);
        expect([...again.hidden()].join(',')).toBe('x');
        expect(readFileSync(path, 'utf8')).toContain('"future"');
        expect(parseColorScheme('{"colorScheme":"neon"}')).toBe('system');
        expect(parseWeekStart('{"weekStart":"sunday"}')).toBe('sunday');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    await it('demo settings hold in memory and write nothing', async () => {
      const memory = createMemorySettings();
      memory.setColorScheme('light');
      memory.setHidden('a', true);
      expect(memory.colorScheme()).toBe('light');
      expect(memory.hidden().size).toBe(1);
    });
  });
};
