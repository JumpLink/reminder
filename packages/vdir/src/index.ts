/**
 * `@reminder/vdir` — a CalendarBackend over plain files (docs/adr/0013, 0014).
 *
 * Layout, the vdirsyncer/khal one: `<root>/<collection>/<item>.ics`, with an optional `displayname`
 * and `color` file per collection. The files are the person's data: nothing here rewrites text it
 * was not asked to change, and an unknown file is left alone.
 *
 * Collection kind: the optional `kind` file (`event` | `reminder`, written when this app creates
 * the collection) wins; otherwise a collection holding a VTODO and no VEVENT is a task list and
 * anything else is a calendar. A mixed collection lists its items per kind by component.
 *
 * ETag: a SHA-256 of the file's bytes. mtime+size would miss an edit that keeps the size within the
 * clock's granularity, and a hash costs one read we make anyway before a conditional write.
 * The check-then-rename is not atomic against another process; the window is a few microseconds
 * and the file system offers no compare-and-swap.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  BackendError,
  ConflictError,
  readEvent,
  unfold,
  type CalendarBackend,
  type CalendarInfo,
  type ItemKind,
  type RawItem,
} from '@reminder/core';

const COMPONENT: Record<ItemKind, string> = { event: 'VEVENT', reminder: 'VTODO' };
const MAX_NAME = 120;
const DEFAULT_PRODID = '-//reminder//vdir//EN';

/** `$XDG_DATA_HOME/<dirName>/vdir`, falling back to `~/.local/share/<dirName>/vdir`. */
export function vdirRoot(dirName: string, env: Record<string, string | undefined> = process.env): string {
  const base = env.XDG_DATA_HOME || join(env.HOME || homedir(), '.local', 'share');
  return join(base, dirName, 'vdir');
}

/** A file-system safe, collision-free name: percent-encoded, or a hash when it would be too long. */
export function safeName(part: string): string {
  const encoded = encodeURIComponent(part).replace(/\./g, '%2E').replace(/\*/g, '%2A');
  if (encoded !== '' && encoded.length <= MAX_NAME) return encoded;
  return `h-${createHash('sha256').update(part).digest('hex')}`;
}

/** An `.ics` the backend could not use; the collection around it still works. */
export interface VdirProblem {
  collection: string;
  file: string;
  reason: string;
}

export interface VdirOptions {
  root: string;
  /** PRODID of the VCALENDAR a bare component is wrapped in. */
  prodId?: string;
  onProblem?: (problem: VdirProblem) => void;
}

export interface VdirBackend extends CalendarBackend {
  readonly root: string;
  /** Problems found by the most recent reads, newest last. */
  problems(): readonly VdirProblem[];
  createCollection(input: { name: string; color?: string; kind: ItemKind }): Promise<string>;
}

export function etagOf(bytes: string): string {
  return `"sha256-${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}"`;
}

function uidOf(ical: string): string | null {
  for (const line of unfold(ical)) {
    const match = /^UID(?:;[^:]*)?:(.*)$/i.exec(line);
    if (match) return match[1].trim() || null;
  }
  return null;
}

/** Complete enough to be one item: a wrapper or bare component, balanced, with a UID. Null when fine. */
function brokenReason(text: string): string | null {
  const lines = unfold(text).map((l) => l.trim().toUpperCase());
  let depth = 0;
  for (const line of lines) {
    if (line.startsWith('BEGIN:')) depth++;
    else if (line.startsWith('END:')) depth--;
    if (depth < 0) return 'unbalanced END';
  }
  if (depth !== 0) return 'unterminated component';
  if (!lines.some((l) => l === 'BEGIN:VEVENT' || l === 'BEGIN:VTODO')) return 'no VEVENT or VTODO';
  if (uidOf(text) === null) return 'no UID';
  return null;
}

function hasComponent(text: string, kind: ItemKind): boolean {
  return unfold(text).some((l) => l.trim().toUpperCase() === `BEGIN:${COMPONENT[kind]}`);
}

function wrap(ical: string, prodId: string): string {
  if (/^BEGIN:VCALENDAR/im.test(ical)) return ical;
  const body = ical.replace(/\r?\n/g, '\r\n').replace(/(?:\r\n)*$/, '\r\n');
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:${prodId}\r\n${body}END:VCALENDAR\r\n`;
}

async function writeAtomic(file: string, text: string): Promise<void> {
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, text, { mode: 0o600 });
    await rename(temporary, file);
  } catch (err) {
    await rm(temporary, { force: true });
    throw err;
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

function inWindow(ical: string, calendarUid: string, from?: string, to?: string): boolean {
  if (!from || !to) return true;
  const event = readEvent(ical, calendarUid);
  if (!event) return false;
  if (event.recurring) return true;
  const start = event.start;
  return !(start < from.slice(0, start.length) || start >= to.slice(0, start.length));
}

export function createVdirBackend(options: VdirOptions): VdirBackend {
  const { root } = options;
  const prodId = options.prodId ?? DEFAULT_PRODID;
  const problems: VdirProblem[] = [];
  const report = (problem: VdirProblem): void => {
    problems.push(problem);
    if (problems.length > 200) problems.shift();
    options.onProblem?.(problem);
  };

  const dirOf = (calendarUid: string) => join(root, safeName(calendarUid));
  const fileOf = (calendarUid: string, uid: string) => join(dirOf(calendarUid), `${safeName(uid)}.ics`);

  async function files(calendarUid: string): Promise<string[]> {
    try {
      return (await readdir(dirOf(calendarUid))).filter((n) => n.endsWith('.ics') && !n.startsWith('.')).sort();
    } catch {
      return [];
    }
  }

  /** Every usable item of a collection; a broken file is reported and skipped. */
  async function entries(calendarUid: string): Promise<{ file: string; text: string; uid: string }[]> {
    const out: { file: string; text: string; uid: string }[] = [];
    for (const name of await files(calendarUid)) {
      const file = join(dirOf(calendarUid), name);
      const text = await readText(file);
      if (text === null) {
        report({ collection: calendarUid, file: name, reason: 'unreadable' });
        continue;
      }
      const reason = brokenReason(text);
      if (reason !== null) {
        report({ collection: calendarUid, file: name, reason });
        continue;
      }
      out.push({ file, text, uid: uidOf(text) ?? '' });
    }
    return out;
  }

  async function locate(calendarUid: string, uid: string): Promise<{ file: string; text: string } | null> {
    const direct = fileOf(calendarUid, uid);
    const text = await readText(direct);
    if (text !== null && uidOf(text) === uid) return { file: direct, text };
    // A file another tool named: found by the UID inside it, never by its name.
    const found = (await entries(calendarUid)).find((e) => e.uid === uid);
    return found ? { file: found.file, text: found.text } : null;
  }

  async function kindOf(calendarUid: string): Promise<ItemKind> {
    const marker = (await readText(join(dirOf(calendarUid), 'kind')))?.trim();
    if (marker === 'event' || marker === 'reminder') return marker;
    let todo = false;
    for (const e of await entries(calendarUid)) {
      if (hasComponent(e.text, 'event')) return 'event';
      if (hasComponent(e.text, 'reminder')) todo = true;
    }
    return todo ? 'reminder' : 'event';
  }

  async function collections(): Promise<string[]> {
    try {
      const dirents = await readdir(root, { withFileTypes: true });
      return dirents
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => d.name)
        .sort();
    } catch {
      return [];
    }
  }

  const decode = (name: string): string => {
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  };

  async function mustExist(calendarUid: string): Promise<void> {
    if (!(await collections()).includes(safeName(calendarUid)))
      throw new BackendError(`no collection ${calendarUid}`);
  }

  return {
    id: 'vdir',
    root,
    problems: () => problems,
    async listCalendars(kind) {
      const out: CalendarInfo[] = [];
      for (const dir of await collections()) {
        const uid = decode(dir);
        const itemKind = await kindOf(uid);
        if (kind && itemKind !== kind) continue;
        const name = (await readText(join(root, dir, 'displayname')))?.trim() || uid;
        out.push({ uid, name, kind: itemKind, backend: 'vdir', account: null });
      }
      return out;
    },
    async listItems(query) {
      const uids = query.calendarUid ? [query.calendarUid] : (await collections()).map(decode);
      const out: RawItem[] = [];
      for (const calendarUid of uids) {
        if (query.calendarUid) await mustExist(calendarUid);
        if (!query.calendarUid && (await kindOf(calendarUid)) !== query.kind) continue;
        for (const e of await entries(calendarUid)) {
          if (!hasComponent(e.text, query.kind)) continue;
          if (query.kind === 'event' && !inWindow(e.text, calendarUid, query.from, query.to)) continue;
          out.push({ calendarUid, ical: e.text });
        }
      }
      return out;
    },
    async getItem(calendarUid, _kind, uid) {
      const found = await locate(calendarUid, uid);
      return found ? { ical: found.text, etag: etagOf(found.text) } : null;
    },
    async createItem(calendarUid, _kind, ical) {
      await mustExist(calendarUid);
      const uid = uidOf(ical);
      if (uid === null) throw new BackendError('the item has no UID');
      if (await locate(calendarUid, uid)) throw new BackendError(`UID ${uid} exists`);
      await writeAtomic(fileOf(calendarUid, uid), wrap(ical, prodId));
      return uid;
    },
    async updateItem(calendarUid, _kind, uid, ical, etag) {
      const found = await locate(calendarUid, uid);
      if (!found) throw new BackendError(`no ${uid} in ${calendarUid}`);
      if (uidOf(ical) !== uid) throw new BackendError(`the update does not carry UID ${uid}`);
      if (etag && etagOf(found.text) !== etag)
        throw new ConflictError(`${uid} changed on disk`, 'vdir', 412);
      await writeAtomic(found.file, wrap(ical, prodId));
    },
    async createCollection({ name, color, kind }) {
      const label = name.trim();
      if (label === '') throw new BackendError('a collection needs a name');
      await mkdir(root, { recursive: true, mode: 0o700 });
      const existing = new Set(await collections());
      let uid = label;
      for (let n = 2; existing.has(safeName(uid)); n++) uid = `${label} ${n}`;
      const dir = join(root, safeName(uid));
      await mkdir(dir, { mode: 0o700 });
      await writeAtomic(join(dir, 'displayname'), `${label}\n`);
      await writeAtomic(join(dir, 'kind'), `${kind}\n`);
      if (color) await writeAtomic(join(dir, 'color'), `${color}\n`);
      return uid;
    },
  };
}
