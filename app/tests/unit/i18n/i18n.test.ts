import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from '@gjsify/unit';
import { _, setCoreTranslator } from '@reminder/core';

import { initI18n } from '../../../src/core/i18n.ts';

// The test bundle runs from app/dist/, the sources from app/tests/unit/i18n/: take whichever exists.
const HERE = fileURLToPath(new URL('.', import.meta.url));

function firstExisting(...candidates: string[]): string {
  const found = candidates.map((c) => join(HERE, c)).find((p) => existsSync(p));
  if (!found) throw new Error(`none of ${candidates.join(', ')} exists`);
  return found;
}

const PO = firstExisting('../po/', '../../../po/');

/** msgid → msgstr for every non-header entry (single-line and wrapped, singular forms only). */
function readPo(name: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const block of readFileSync(join(PO, name), 'utf8').split('\n\n')) {
    const grab = (tag: string) => {
      const m = new RegExp(`^${tag} ((?:".*"\\n?)+)`, 'm').exec(block);
      return m ? [...m[1].matchAll(/"(.*)"/g)].map((x) => JSON.parse(`"${x[1]}"`)).join('') : undefined;
    };
    const id = grab('msgid');
    if (id) entries.set(id, grab('msgstr') ?? grab('msgstr\\[0\\]') ?? '');
  }
  return entries;
}

export default async () => {
  await describe('i18n catalogue', async () => {
    await it('translates every msgid of the template into German', async () => {
      const pot = readPo('reminder.pot');
      const de = readPo('de.po');
      expect(pot.size > 50).toBe(true);
      const missing = [...pot.keys()].filter((id) => !de.get(id));
      expect(missing.join(' | ')).toBe('');
    });
  });

  await describe('i18n runtime', async () => {
    await it('answers in German under LANGUAGE=de and in English without a catalogue', async () => {
      const gjs = (
        globalThis as { imports?: { gi: { GLib: { setenv(k: string, v: string, o: boolean): boolean } } } }
      ).imports;
      if (!gjs) return; // Node has no GJS gettext module: the English msgid is the contract there.
      gjs.gi.GLib.setenv('LC_ALL', 'de_AT.UTF-8', true);
      gjs.gi.GLib.setenv('LANGUAGE', 'de', true);
      const dir = firstExisting('./locale', '../../../dist/locale');
      expect(initI18n(dir)).toBe(true);
      expect(_('No open reminders.')).toBe('Keine offenen Erinnerungen.');
      expect(_('not in any catalogue')).toBe('not in any catalogue');
      setCoreTranslator(null);
      expect(_('No open reminders.')).toBe('No open reminders.');
    });
  });
};
