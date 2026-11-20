import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';
import { createVdirBackend, safeName, vdirRoot } from '@reminder/vdir';

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
  });
};
