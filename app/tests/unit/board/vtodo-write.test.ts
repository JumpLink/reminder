import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';
import {
  boardSourceWriteContract,
  ConflictError,
  createVtodoBoardSource,
  InputError,
  type Card,
} from '@reminder/core';
import { createVdirBackend } from '@reminder/vdir';

import { calendar, createFakeBackend } from '../fake-backend.ts';

const now = () => new Date('2026-11-20T10:00:00Z');

const wrap = (uid: string, lines: string[]): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Some Other Client//EN',
    'BEGIN:VTODO',
    `UID:${uid}`,
    'DTSTAMP:20261101T080000Z',
    ...lines,
    'END:VTODO',
    'END:VCALENDAR',
    '',
  ].join('\r\n');

/** The stamps a write bumps; everything else must stay byte-identical. */
const STAMPS = /^(SEQUENCE|DTSTAMP|LAST-MODIFIED):/;
const body = (ical: string): string[] => ical.split('\r\n').filter((line) => !STAMPS.test(line));

const FOREIGN = ['X-NEXTCLOUD-TASKS-HINT:keep-me', 'X-OC-HIDESUBTASKS:1', 'X-JTX-PRIORITY-HINT:keep-too'];

const items = (): Record<string, string[]> => ({
  shop: [
    wrap('t1', [
      'SUMMARY:Sharpen the plane iron',
      'STATUS:NEEDS-ACTION',
      'X-APPLE-SORT-ORDER:1024',
      ...FOREIGN,
    ]),
    wrap('t2', ['SUMMARY:Rewire the bench lamp', 'STATUS:NEEDS-ACTION', 'X-APPLE-SORT-ORDER:2048']),
    wrap('t3', ['SUMMARY:Oil the vice', 'STATUS:NEEDS-ACTION', 'X-APPLE-SORT-ORDER:2049']),
    wrap('t4', ['SUMMARY:Order a new blade', 'STATUS:IN-PROCESS', 'X-APPLE-SORT-ORDER:512']),
    wrap('t5', ['SUMMARY:Park the idea', 'STATUS:NEEDS-ACTION', 'X-STATUS:Ideen']),
    wrap('t6', ['SUMMARY:Legacy backlog', 'STATUS:NEEDS-ACTION', 'X-REMINDER-BOARD-COLUMN:BACKLOG']),
  ],
});

const fake = () => createFakeBackend([calendar('shop', 'reminder', 'Workshop')], items());
const writer = (backend = fake()) => ({
  backend,
  source: createVtodoBoardSource(backend, { id: 'home', writable: true, now }),
});

async function cards(source: ReturnType<typeof writer>['source']): Promise<Card[]> {
  const board = (await source.listBoards())[0];
  const page = await source.listCards(board, { mine: 'all', includeClosed: true });
  return page.kind === 'changed' ? page.cards : [];
}
const byId = async (source: ReturnType<typeof writer>['source'], id: string): Promise<Card> => {
  const found = (await cards(source)).find((c) => c.ref.id === id);
  if (!found) throw new Error(`no card ${id}`);
  return found;
};
const stored = (backend: ReturnType<typeof fake>, uid: string): string => {
  const found = backend.store.get('shop')?.find((ical) => ical.includes(`UID:${uid}\r\n`));
  if (!found) throw new Error(`no ${uid}`);
  return found;
};
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

export default async () => {
  await describe('VTODO board writes: contract', async () => {
    for (const check of boardSourceWriteContract(() => writer().source)) {
      await it(`fake backend: ${check.name}`, async () => {
        await check.run();
      });
    }
    for (const check of boardSourceWriteContract(async () => {
      const dir = await mkdtemp(join(tmpdir(), 'reminder-board-'));
      const backend = createVdirBackend({ root: dir });
      const uid = await backend.createCollection({ name: 'Workshop', kind: 'reminder' });
      for (const ical of items().shop) await backend.createItem(uid, 'reminder', ical);
      return createVtodoBoardSource(backend, { id: 'home', writable: true, now });
    })) {
      await it(`vdir: ${check.name}`, async () => {
        await check.run();
      });
    }
  });

  await describe('VTODO board writes: lanes', async () => {
    await it('is read-only unless the frontend asks for writes', async () => {
      const source = createVtodoBoardSource(fake(), { id: 'home' });
      expect(source.describe().canWrite).toBe(false);
      expect(source.writeCard === undefined).toBe(true);
    });

    await it('refuses a list the backend reports as read-only', async () => {
      const info = { ...calendar('shop', 'reminder'), readOnly: true };
      const backend = createFakeBackend([info], items());
      const source = createVtodoBoardSource(backend, { id: 'home', writable: true, now });
      const first = (await cards(source))[0];
      const err = await rejection(
        (source.writeCard as NonNullable<typeof source.writeCard>)({
          kind: 'move',
          ref: first.ref,
          version: first.version,
          toColumn: 'IN-PROCESS',
        }),
      );
      expect(err instanceof InputError).toBe(true);
    });

    await it('reads X-STATUS names and the superseded column as backlog', async () => {
      const { source } = writer();
      expect((await byId(source, 't5')).sourceColumn).toBe('BACKLOG');
      expect((await byId(source, 't6')).sourceColumn).toBe('BACKLOG');
      expect((await byId(source, 't1')).sourceColumn).toBe('NEEDS-ACTION');
    });

    await it('walks Todo → In progress → Done → Backlog → Todo, touching only its own lines', async () => {
      const { backend, source } = writer();
      const original = stored(backend, 't1');
      const write = source.writeCard as NonNullable<typeof source.writeCard>;
      const go = async (toColumn: string) => {
        const card = await byId(source, 't1');
        return write({ kind: 'move', ref: card.ref, version: card.version, toColumn });
      };

      await go('IN-PROCESS');
      const unordered = (ical: string) => body(ical).filter((l) => !l.startsWith('X-APPLE-SORT-ORDER'));
      expect(unordered(stored(backend, 't1')).join('|')).toBe(
        unordered(original)
          .map((l) => (l === 'STATUS:NEEDS-ACTION' ? 'STATUS:IN-PROCESS' : l))
          .join('|'),
      );

      await go('COMPLETED');
      const done = body(stored(backend, 't1'));
      expect(done.includes('STATUS:COMPLETED')).toBe(true);
      expect(done.includes('PERCENT-COMPLETE:100')).toBe(true);
      expect(done.some((l) => l.startsWith('COMPLETED:'))).toBe(true);
      for (const line of FOREIGN) expect(done.includes(line)).toBe(true);

      await go('BACKLOG');
      const backlog = body(stored(backend, 't1'));
      expect(backlog.includes('STATUS:NEEDS-ACTION')).toBe(true);
      expect(backlog.includes('X-STATUS:BACKLOG')).toBe(true);
      expect(backlog.some((l) => l.startsWith('X-REMINDER-'))).toBe(false);

      await go('NEEDS-ACTION');
      const back = body(stored(backend, 't1'));
      expect(back.some((l) => l.startsWith('X-STATUS'))).toBe(false);
      expect(back.includes('STATUS:NEEDS-ACTION')).toBe(true);
      for (const line of FOREIGN) expect(back.includes(line)).toBe(true);
      expect((await byId(source, 't1')).sourceColumn).toBe('NEEDS-ACTION');
    });

    await it('drops the superseded column property when a card leaves the backlog', async () => {
      const { backend, source } = writer();
      const card = await byId(source, 't6');
      const write = source.writeCard as NonNullable<typeof source.writeCard>;
      await write({ kind: 'move', ref: card.ref, version: card.version, toColumn: 'NEEDS-ACTION' });
      expect(stored(backend, 't6').includes('X-REMINDER-BOARD-COLUMN')).toBe(false);
    });

    await it('bumps SEQUENCE and the stamps like any other write', async () => {
      const { backend, source } = writer();
      const card = await byId(source, 't2');
      const write = source.writeCard as NonNullable<typeof source.writeCard>;
      await write({ kind: 'move', ref: card.ref, version: card.version, toColumn: 'IN-PROCESS' });
      const text = stored(backend, 't2');
      expect(text.includes('SEQUENCE:1')).toBe(true);
      expect(text.includes('LAST-MODIFIED:20261120T100000Z')).toBe(true);
    });

    await it('refuses a stale version and an unknown column, writing nothing', async () => {
      const { backend, source } = writer();
      const card = await byId(source, 't2');
      const write = source.writeCard as NonNullable<typeof source.writeCard>;
      const before = stored(backend, 't2');
      backend.tamper('shop', 't2', before.replace('Rewire', 'Rewired'));
      const tampered = stored(backend, 't2');
      const stale = await rejection(
        write({ kind: 'move', ref: card.ref, version: card.version, toColumn: 'IN-PROCESS' }),
      );
      expect(stale instanceof ConflictError).toBe(true);
      expect(stored(backend, 't2')).toBe(tampered);
      const fresh = await byId(source, 't2');
      const unknown = await rejection(
        write({ kind: 'move', ref: fresh.ref, version: fresh.version, toColumn: 'NOPE' }),
      );
      expect(unknown instanceof InputError).toBe(true);
    });
  });

  await describe('VTODO board writes: order', async () => {
    await it('puts a card between neighbours at the midpoint, one write', async () => {
      const { backend, source } = writer();
      const card = await byId(source, 't4');
      const write = source.writeCard as NonNullable<typeof source.writeCard>;
      const calls = backend.calls.length;
      await write({
        kind: 'move',
        ref: card.ref,
        version: card.version,
        toColumn: 'NEEDS-ACTION',
        position: 1,
      });
      expect(body(stored(backend, 't4')).includes('X-APPLE-SORT-ORDER:1536')).toBe(true);
      expect(backend.calls.slice(calls).filter((c) => c.startsWith('updateItem')).length).toBe(1);
    });

    await it('renumbers the column with 1024 gaps when no integer fits', async () => {
      const { source } = writer();
      const card = await byId(source, 't4');
      const write = source.writeCard as NonNullable<typeof source.writeCard>;
      await write({
        kind: 'move',
        ref: card.ref,
        version: card.version,
        toColumn: 'NEEDS-ACTION',
        position: 2,
      });
      const order = (await cards(source))
        .filter((c) => c.sourceColumn === 'NEEDS-ACTION' && c.order != null)
        .sort((a, b) => (a.order as number) - (b.order as number))
        .map((c) => `${c.ref.id}:${c.order}`);
      expect(order.join(',')).toBe('t1:1024,t2:2048,t4:3072,t3:4096');
    });

    await it('keeps the old reading order when a renumbering stops half way', async () => {
      const crowded = createFakeBackend([calendar('shop', 'reminder', 'Workshop')], {
        shop: [
          wrap('a', ['SUMMARY:First', 'STATUS:NEEDS-ACTION', 'X-APPLE-SORT-ORDER:1']),
          wrap('b', ['SUMMARY:Second', 'STATUS:NEEDS-ACTION', 'X-APPLE-SORT-ORDER:2']),
          wrap('c', ['SUMMARY:Third', 'STATUS:NEEDS-ACTION', 'X-APPLE-SORT-ORDER:3']),
          wrap('m', ['SUMMARY:Moved', 'STATUS:IN-PROCESS']),
        ],
      });
      const update = crowded.updateItem.bind(crowded);
      let left = 1;
      crowded.updateItem = async (...args: Parameters<typeof update>) => {
        if (left-- <= 0) throw new Error('connection lost');
        return update(...args);
      };
      const { source } = writer(crowded);
      const card = await byId(source, 'm');
      const write = source.writeCard as NonNullable<typeof source.writeCard>;
      const err = await rejection(
        write({ kind: 'move', ref: card.ref, version: card.version, toColumn: 'NEEDS-ACTION', position: 1 }),
      );
      expect(err instanceof Error).toBe(true);
      const column = (await cards(source))
        .filter((c) => c.sourceColumn === 'NEEDS-ACTION')
        .sort((x, y) => (x.order as number) - (y.order as number))
        .map((c) => c.ref.id);
      expect(column.join(',')).toBe('a,b,c');
    });

    await it('leaves lists without positions unordered until something is placed', async () => {
      const { backend, source } = writer();
      const card = await byId(source, 't5');
      const write = source.writeCard as NonNullable<typeof source.writeCard>;
      await write({ kind: 'move', ref: card.ref, version: card.version, toColumn: 'CANCELLED' });
      expect(stored(backend, 't5').includes('X-APPLE-SORT-ORDER')).toBe(false);
    });

    await it('creates a card into each lane, on top of an ordered column', async () => {
      const { backend, source } = writer();
      const write = source.writeCard as NonNullable<typeof source.writeCard>;
      const lanes: Record<string, string> = {
        BACKLOG: 'X-STATUS:BACKLOG',
        'NEEDS-ACTION': 'STATUS:NEEDS-ACTION',
        'IN-PROCESS': 'STATUS:IN-PROCESS',
        COMPLETED: 'STATUS:COMPLETED',
        CANCELLED: 'STATUS:CANCELLED',
      };
      for (const [column, line] of Object.entries(lanes)) {
        const made = await write({ kind: 'create', board: 'shop', column, title: `New in ${column}` });
        expect(made.sourceColumn).toBe(column);
        expect(made.title).toBe(`New in ${column}`);
        expect(stored(backend, made.ref.id).includes(line)).toBe(true);
      }
      const todo = (await cards(source)).find((c) => c.title === 'New in NEEDS-ACTION');
      expect(todo?.order).toBe(0);
    });
  });
};
