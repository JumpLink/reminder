#!/usr/bin/env node
// Every msgid the source marks must be translated in every catalogue, completely and not fuzzily.
//
// gettext fails SOFT: a missing msgstr shows the English msgid, and nothing says so. For the app's
// domain this runs the same extraction as `dev/i18n.sh extract` into a temporary file and fails when
//   · a source file with `_(` / `_n(` or any `.blp` is missing from po/POTFILES.in,
//   · the committed .pot is stale (a msgid was added or changed without `i18n:extract`),
//   · a catalogue misses a msgid, leaves it empty or fuzzy,
//   · a msgstr drops or renames a `{name}` placeholder.
// @gjsify/pim and @gjsify/adwaita-extended check their own catalogues where they live (gjsify).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

import { parsePo } from './po.mjs';

const APP = new URL('..', import.meta.url).pathname;
const PACKAGES = resolve(APP, '../packages');

// `root` is the directory POTFILES.in paths are relative to; `scan` lists the source roots that
// feed the domain, `skip` what the extract script leaves out on purpose.
const DOMAINS = [
  {
    name: 'reminder',
    root: APP,
    scan: [
      join(APP, 'src'),
      ...readdirSync(PACKAGES, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(PACKAGES, d.name, 'src')),
    ],
    skip: () => false,
  },
];

const names = (s) =>
  [...s.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join(',');
const key = (e) => e.msgid;
const MARKER = /(^|[^\w.$])_n?\(/;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function xgettext(args, cwd) {
  const res = spawnSync('xgettext', args, { cwd, encoding: 'utf8' });
  if (res.error || res.status !== 0) {
    console.error(`check-i18n: xgettext failed — is gettext installed? ${res.error?.message ?? res.stderr}`);
    process.exit(1);
  }
}

const tmp = mkdtempSync(join(tmpdir(), 'check-i18n-'));
const problems = [];
try {
  for (const d of DOMAINS) {
    const poDir = join(d.root, 'po');
    const listed = readFileSync(join(poDir, 'POTFILES.in'), 'utf8').split('\n').filter(Boolean);
    const listedSet = new Set(listed.map((f) => resolve(d.root, f)));

    for (const dir of d.scan) {
      for (const file of walk(dir)) {
        const rel = relative(d.root, file);
        if (d.skip(file) || listedSet.has(file)) continue;
        const blp = file.endsWith('.blp');
        const ts = file.endsWith('.ts') && MARKER.test(readFileSync(file, 'utf8'));
        if (blp || ts) problems.push(`${d.name}: ${rel} marks strings but is not in po/POTFILES.in`);
      }
    }

    const js = listed.filter((f) => !f.endsWith('.blp'));
    const blp = listed.filter((f) => f.endsWith('.blp'));
    const pot = join(tmp, `${d.name}.pot`);
    const common = ['--from-code=UTF-8', '--keyword=_', `--output=${pot}`];
    writeFileSync(join(tmp, `${d.name}.js`), js.join('\n') + '\n');
    xgettext(
      [`--files-from=${join(tmp, `${d.name}.js`)}`, '--language=JavaScript', '--keyword=_n:1,2', ...common],
      d.root,
    );
    if (blp.length > 0) {
      writeFileSync(join(tmp, `${d.name}.blp`), blp.join('\n') + '\n');
      xgettext(
        [
          `--files-from=${join(tmp, `${d.name}.blp`)}`,
          '--join-existing',
          '--language=C',
          '--keyword=C_:1c,2',
          ...common,
        ],
        d.root,
      );
    }
    const fresh = parsePo(readFileSync(pot, 'utf8'));
    const committed = new Set(parsePo(readFileSync(join(poDir, `${d.name}.pot`), 'utf8')).map(key));
    const freshKeys = new Set(fresh.map(key));
    const stale =
      fresh.filter((e) => !committed.has(key(e))).length +
      [...committed].filter((k) => !freshKeys.has(k)).length;
    if (stale > 0)
      problems.push(
        `${d.name}: po/${d.name}.pot is stale (${stale} msgid(s) differ) — run \`gjsify run i18n:extract\``,
      );

    const langs = readFileSync(join(poDir, 'LINGUAS'), 'utf8').split(/\s+/).filter(Boolean);
    for (const lang of langs) {
      const po = new Map(parsePo(readFileSync(join(poDir, `${lang}.po`), 'utf8')).map((e) => [key(e), e]));
      for (const want of fresh) {
        const got = po.get(key(want));
        const where = `${d.name}/${lang}.po: ${JSON.stringify(want.msgid).slice(0, 80)}`;
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
