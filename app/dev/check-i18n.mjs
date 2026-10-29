#!/usr/bin/env node
// Every msgid the source marks must be translated in every catalogue, completely and not fuzzily.
//
// gettext fails SOFT: a missing msgstr shows the English msgid, and nothing says so. This runs the
// same extraction as `dev/i18n.sh extract` into a temporary file and fails when
//   · the committed .pot is stale (a msgid was added or changed without `i18n:extract`),
//   · a catalogue misses a msgid, leaves it empty or fuzzy,
//   · a msgstr drops or renames a `{name}` placeholder.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parsePo } from './po.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const names = (s) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');
const key = (e) => e.msgid;

const tmp = mkdtempSync(join(tmpdir(), 'check-i18n-'));
const problems = [];
try {
  const pot = join(tmp, 'fresh.pot');
  const res = spawnSync(
    'xgettext',
    [
      '--files-from=po/POTFILES.in',
      `--output=${pot}`,
      '--from-code=UTF-8',
      '--language=JavaScript',
      '--keyword=_',
      '--keyword=_n:1,2',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (res.error || res.status !== 0) {
    console.error(`check-i18n: xgettext failed — is gettext installed? ${res.error?.message ?? res.stderr}`);
    process.exit(1);
  }
  const fresh = parsePo(readFileSync(pot, 'utf8'));
  const committed = new Set(parsePo(readFileSync(join(ROOT, 'po', 'reminder.pot'), 'utf8')).map(key));
  const freshKeys = new Set(fresh.map(key));
  const stale =
    fresh.filter((e) => !committed.has(key(e))).length +
    [...committed].filter((k) => !freshKeys.has(k)).length;
  if (stale > 0)
    problems.push(`po/reminder.pot is stale (${stale} msgid(s) differ) — run \`gjsify run i18n:extract\``);

  const langs = readFileSync(join(ROOT, 'po', 'LINGUAS'), 'utf8')
    .split(/\s+/)
    .filter(Boolean);
  for (const lang of langs) {
    const po = new Map(parsePo(readFileSync(join(ROOT, 'po', `${lang}.po`), 'utf8')).map((e) => [key(e), e]));
    for (const want of fresh) {
      const got = po.get(key(want));
      const where = `${lang}.po: ${JSON.stringify(want.msgid).slice(0, 80)}`;
      if (!got) problems.push(`${where} — missing`);
      else if (got.flags.includes('fuzzy')) problems.push(`${where} — fuzzy`);
      else if (got.msgstr.length === 0 || got.msgstr.some((s) => !s))
        problems.push(`${where} — untranslated`);
      else if (
        names(got.msgstr[0]) !== names(want.msgid_plural ?? want.msgid) &&
        want.msgid_plural === undefined
      )
        problems.push(`${where} — placeholders differ`);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(`check-i18n: ${problems.length} problem(s):`);
  for (const p of problems.slice(0, 40)) console.error(`  ${p}`);
  process.exit(1);
}
console.log('check-i18n: every msgid is translated in every catalogue.');
