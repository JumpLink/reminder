import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';
import { BackendError } from '@reminder/core';
import { createVdirBackend, safeName, vdirRoot, type VdirProblem } from '@reminder/vdir';

import { backendContract } from '../backend-contract.ts';
import { calendar, createFakeBackend } from '../fake-backend.ts';

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'reminder-vdir-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const VCAL = (uid: string, body = 'SUMMARY:Sample'): string =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//other tool//EN\r\nBEGIN:VTODO\r\nUID:${uid}\r\n${body}\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`;

const VEVENT = (uid: string, ...lines: string[]): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//other tool//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    ...lines,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

/** A collection directory with the given files, written as another tool would. */
async function seed(dir: string, name: string, files: Record<string, string>): Promise<void> {
  await mkdir(join(dir, name), { recursive: true });
  for (const [file, text] of Object.entries(files)) await writeFile(join(dir, name, file), text);
}

const uids = (items: { ical: string }[]): string =>
  items
    .map((i) => /UID:(.*)/.exec(i.ical)?.[1].trim() ?? '')
    .sort()
    .join(',');

export default async () => {
  await backendContract('fake', async () => ({
    backend: createFakeBackend([calendar('list', 'reminder')]),
    calendarUid: 'list',
    cleanup: async () => {},
  }));

  await backendContract('vdir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reminder-vdir-'));
    const backend = createVdirBackend({ root: dir });
    const calendarUid = await backend.createCollection({ name: 'Errands', kind: 'reminder' });
    return { backend, calendarUid, cleanup: () => rm(dir, { recursive: true, force: true }) };
  });

  await describe('vdir', async () => {
    await it('locates the root under XDG_DATA_HOME, else ~/.local/share', async () => {
      expect(vdirRoot('reminder', { XDG_DATA_HOME: '/x/data' })).toBe('/x/data/reminder/vdir');
      expect(vdirRoot('reminder', { HOME: '/home/someone' })).toBe(
        '/home/someone/.local/share/reminder/vdir',
      );
    });

    await it('encodes UIDs into safe, distinct file names', async () => {
      expect(safeName('a/b')).toBe('a%2Fb');
      expect(safeName('..')).toBe('%2E%2E');
      expect(safeName('x'.repeat(300)).startsWith('h-')).toBe(true);
    });

    await it('reads name and colour files and a foreign collection', async () => {
      await withDir(async (dir) => {
        await mkdir(join(dir, 'tools'));
        await writeFile(join(dir, 'tools', 'displayname'), 'Workshop\n');
        await writeFile(join(dir, 'tools', 'one.ics'), VCAL('u-1'));
        const lists = await createVdirBackend({ root: dir }).listCalendars();
        expect(lists.length).toBe(1);
        expect(lists[0].name).toBe('Workshop');
        expect(lists[0].kind).toBe('reminder');
      });
    });

    await it('stores a color file and a kind marker on creation', async () => {
      await withDir(async (dir) => {
        const backend = createVdirBackend({ root: dir });
        const uid = await backend.createCollection({ name: 'Home', color: '#33aa55', kind: 'reminder' });
        expect((await readFile(join(dir, safeName(uid), 'color'), 'utf8')).trim()).toBe('#33aa55');
        expect((await backend.createCollection({ name: 'Home', kind: 'reminder' })) === uid).toBe(false);
      });
    });

    await it('ignores unknown files and reports a broken .ics without failing the collection', async () => {
      await withDir(async (dir) => {
        await mkdir(join(dir, 'l'));
        await writeFile(join(dir, 'l', 'good.ics'), VCAL('good'));
        await writeFile(join(dir, 'l', 'broken.ics'), 'BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\nSUMMARY:x\r\n');
        await writeFile(join(dir, 'l', 'notes.txt'), 'not an item');
        await writeFile(join(dir, 'l', '.hidden.ics'), VCAL('hidden'));
        const backend = createVdirBackend({ root: dir });
        const items = await backend.listItems({ kind: 'reminder', calendarUid: 'l' });
        expect(items.length).toBe(1);
        const problems = backend.problems();
        expect(problems.length).toBe(1);
        expect(problems[0].file).toBe('broken.ics');
        expect((await readdir(join(dir, 'l'))).includes('notes.txt')).toBe(true);
      });
    });

    await it('finds an item another tool named by its UID, and writes back to that file', async () => {
      await withDir(async (dir) => {
        await mkdir(join(dir, 'l'));
        await writeFile(join(dir, 'l', 'whatever-name.ics'), VCAL('u-9'));
        const backend = createVdirBackend({ root: dir });
        const got = await backend.getItem('l', 'reminder', 'u-9');
        expect(got === null).toBe(false);
        await backend.updateItem('l', 'reminder', 'u-9', VCAL('u-9', 'SUMMARY:Edited'), got?.etag);
        expect((await readFile(join(dir, 'l', 'whatever-name.ics'), 'utf8')).includes('SUMMARY:Edited')).toBe(
          true,
        );
        expect((await readdir(join(dir, 'l'))).length).toBe(1);
      });
    });

    await it('keeps every untouched byte: stores the text as given, folding and X- lines included', async () => {
      await withDir(async (dir) => {
        await mkdir(join(dir, 'l'));
        const text = VCAL('u-5', 'SUMMARY:A very long\r\n  folded line\r\nX-VENDOR;FOO=bar:keep me');
        await writeFile(join(dir, 'l', 'u-5.ics'), text);
        const backend = createVdirBackend({ root: dir });
        const got = await backend.getItem('l', 'reminder', 'u-5');
        expect(got?.ical).toBe(text);
        await backend.updateItem('l', 'reminder', 'u-5', got?.ical ?? '', got?.etag);
        expect(await readFile(join(dir, 'l', 'u-5.ics'), 'utf8')).toBe(text);
      });
    });

    await it('wraps a bare component in a VCALENDAR on disk', async () => {
      await withDir(async (dir) => {
        const backend = createVdirBackend({ root: dir });
        const uid = await backend.createCollection({ name: 'L', kind: 'reminder' });
        await backend.createItem(uid, 'reminder', 'BEGIN:VTODO\r\nUID:w-1\r\nSUMMARY:x\r\nEND:VTODO\r\n');
        const disk = await readFile(join(dir, safeName(uid), 'w-1.ics'), 'utf8');
        expect(disk.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
        expect(disk.endsWith('END:VCALENDAR\r\n')).toBe(true);
      });
    });

    await it('leaves no temporary file after writes, and none when a write fails', async () => {
      await withDir(async (dir) => {
        const backend = createVdirBackend({ root: dir });
        const uid = await backend.createCollection({ name: 'L', kind: 'reminder' });
        await backend.createItem(uid, 'reminder', VCAL('a-1'));
        const stale = await backend.getItem(uid, 'reminder', 'a-1');
        await backend.updateItem(uid, 'reminder', 'a-1', VCAL('a-1', 'SUMMARY:B'), stale?.etag);
        let failed = false;
        try {
          await backend.updateItem(uid, 'reminder', 'a-1', VCAL('a-1', 'SUMMARY:C'), stale?.etag);
        } catch {
          failed = true;
        }
        expect(failed).toBe(true);
        const names = await readdir(join(dir, safeName(uid)));
        expect(names.some((n) => n.endsWith('.tmp'))).toBe(false);
        expect((await readFile(join(dir, safeName(uid), 'a-1.ics'), 'utf8')).includes('SUMMARY:B')).toBe(
          true,
        );
      });
    });

    await it('lists the events that overlap the window, including those that began before it', async () => {
      await withDir(async (dir) => {
        await seed(dir, 'cal', {
          'inside.ics': VEVENT('inside', 'DTSTART:20261110T090000Z', 'DTEND:20261110T100000Z'),
          'before.ics': VEVENT('before', 'DTSTART:20261101T090000Z', 'DTEND:20261101T100000Z'),
          'after.ics': VEVENT('after', 'DTSTART:20261201T090000Z', 'DTEND:20261201T100000Z'),
          'spanning.ics': VEVENT('spanning', 'DTSTART:20261108T090000Z', 'DTEND:20261111T090000Z'),
          'trip.ics': VEVENT('trip', 'DTSTART;VALUE=DATE:20261107', 'DTEND;VALUE=DATE:20261112'),
          'ended.ics': VEVENT('ended', 'DTSTART;VALUE=DATE:20261107', 'DTEND;VALUE=DATE:20261110'),
          'day.ics': VEVENT('day', 'DTSTART;VALUE=DATE:20261115'),
          'series.ics': VEVENT('series', 'DTSTART:20260101T090000Z', 'RRULE:FREQ=WEEKLY'),
        });
        const backend = createVdirBackend({ root: dir });
        const items = await backend.listItems({
          kind: 'event',
          calendarUid: 'cal',
          from: '2026-11-10T00:00:00Z',
          to: '2026-11-20T00:00:00Z',
        });
        // A series is handed on whole: expanding it is the caller's work, not the backend's.
        expect(uids(items)).toBe('day,inside,series,spanning,trip');
        const all = await backend.listItems({ kind: 'event', calendarUid: 'cal' });
        expect(all.length).toBe(8);
      });
    });

    await it('ignores the window for reminders', async () => {
      await withDir(async (dir) => {
        await seed(dir, 'l', { 'a.ics': VCAL('a', 'DUE:20200101T090000Z') });
        const items = await createVdirBackend({ root: dir }).listItems({
          kind: 'reminder',
          calendarUid: 'l',
          from: '2026-11-10T00:00:00Z',
          to: '2026-11-20T00:00:00Z',
        });
        expect(items.length).toBe(1);
      });
    });

    await it('tells events from reminders: marker first, then content, empty means events', async () => {
      await withDir(async (dir) => {
        await seed(dir, 'meetings', { 'm.ics': VEVENT('m', 'DTSTART:20261110T090000Z') });
        await seed(dir, 'chores', { 'c.ics': VCAL('c') });
        await seed(dir, 'empty', {});
        await seed(dir, 'marked', { kind: 'reminder\n' });
        const backend = createVdirBackend({ root: dir });
        const kinds = (await backend.listCalendars()).map((c) => `${c.uid}=${c.kind}`).join(' ');
        expect(kinds).toBe('chores=reminder empty=event marked=reminder meetings=event');
        const reminders = (await backend.listCalendars('reminder')).map((c) => c.uid).join(',');
        expect(reminders).toBe('chores,marked');
        const items = await backend.listItems({ kind: 'reminder' });
        expect(uids(items)).toBe('c');
      });
    });

    await it('decodes the directory name back into the collection uid', async () => {
      await withDir(async (dir) => {
        const backend = createVdirBackend({ root: dir });
        const uid = await backend.createCollection({ name: 'Home/Garden', kind: 'reminder' });
        expect(uid).toBe('Home/Garden');
        expect((await readdir(dir)).join(',')).toBe('Home%2FGarden');
        await backend.createItem(uid, 'reminder', VCAL('g-1'));
        const lists = await backend.listCalendars();
        expect(lists[0].uid).toBe('Home/Garden');
        expect((await backend.listItems({ kind: 'reminder', calendarUid: uid })).length).toBe(1);
      });
    });

    await it('refuses a create without a UID, with a taken UID, or into no collection', async () => {
      await withDir(async (dir) => {
        await seed(dir, 'l', { 'other-name.ics': VCAL('taken') });
        const backend = createVdirBackend({ root: dir });
        const noUid = await rejection(
          backend.createItem('l', 'reminder', 'BEGIN:VTODO\r\nSUMMARY:x\r\nEND:VTODO\r\n'),
        );
        expect(noUid instanceof BackendError).toBe(true);
        // Taken even though the file is named after something else.
        expect(
          (await rejection(backend.createItem('l', 'reminder', VCAL('taken')))) instanceof BackendError,
        ).toBe(true);
        expect(
          (await rejection(backend.createItem('missing', 'reminder', VCAL('n')))) instanceof BackendError,
        ).toBe(true);
        expect(
          (await rejection(backend.listItems({ kind: 'reminder', calendarUid: 'missing' }))) instanceof
            BackendError,
        ).toBe(true);
        expect((await readdir(join(dir, 'l'))).join(',')).toBe('other-name.ics');
      });
    });

    await it('refuses an update of an unknown item or under another UID, and writes without an etag', async () => {
      await withDir(async (dir) => {
        await seed(dir, 'l', { 'a.ics': VCAL('a') });
        const backend = createVdirBackend({ root: dir });
        expect(
          (await rejection(backend.updateItem('l', 'reminder', 'nope', VCAL('nope')))) instanceof
            BackendError,
        ).toBe(true);
        expect(
          (await rejection(backend.updateItem('l', 'reminder', 'a', VCAL('b')))) instanceof BackendError,
        ).toBe(true);
        await backend.updateItem('l', 'reminder', 'a', VCAL('a', 'SUMMARY:No etag'));
        expect((await readFile(join(dir, 'l', 'a.ics'), 'utf8')).includes('SUMMARY:No etag')).toBe(true);
      });
    });

    await it('writes items readable by the owner only', async () => {
      await withDir(async (dir) => {
        const backend = createVdirBackend({ root: dir });
        const uid = await backend.createCollection({ name: 'L', kind: 'reminder' });
        await backend.createItem(uid, 'reminder', VCAL('p-1'));
        expect(((await stat(join(dir, safeName(uid), 'p-1.ics'))).mode & 0o777).toString(8)).toBe('600');
        expect(((await stat(join(dir, safeName(uid)))).mode & 0o777).toString(8)).toBe('700');
      });
    });

    await it('passes each problem to onProblem and keeps only the latest 200', async () => {
      await withDir(async (dir) => {
        const files: Record<string, string> = {};
        for (let i = 0; i < 205; i++) files[`b${String(i).padStart(3, '0')}.ics`] = 'BEGIN:VTODO\r\n';
        await seed(dir, 'l', files);
        const seen: VdirProblem[] = [];
        const backend = createVdirBackend({ root: dir, onProblem: (p) => seen.push(p) });
        await backend.listItems({ kind: 'reminder', calendarUid: 'l' });
        expect(seen.length).toBe(205);
        expect(backend.problems().length).toBe(200);
        expect(backend.problems()[0].file).toBe('b005.ics');
        expect(seen[0].reason).toBe('unterminated component');
      });
    });
  });
};
