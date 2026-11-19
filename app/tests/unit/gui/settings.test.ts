import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';

import { createGuiSettings, parseHidden, settingsPath } from '../../../src/frontends/gui/settings.ts';

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
  });
};
