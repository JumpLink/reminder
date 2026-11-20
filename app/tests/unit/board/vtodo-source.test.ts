import { describe, expect, it } from '@gjsify/unit';
import { boardSourceContract, createVtodoBoardSource } from '@reminder/core';

import { calendar, createFakeBackend, vtodo } from '../fake-backend.ts';

/** Invented addresses only: `.invalid` can never resolve (RFC 2606). */
const ME = 'pat@example.invalid';
const OTHER = 'robin@example.invalid';

const ITEMS: Record<string, string[]> = {
  shop: [
    vtodo('t1', ['SUMMARY:Sharpen the plane iron', 'STATUS:NEEDS-ACTION', 'DUE;VALUE=DATE:20261201']),
    vtodo('t2', [
      'SUMMARY:Rewire the bench lamp',
      'STATUS:IN-PROCESS',
      'PERCENT-COMPLETE:40',
      'CATEGORIES:shop,electrics',
      'LAST-MODIFIED:20261118T080000Z',
      `ATTENDEE;CN=Pat:mailto:${ME}`,
    ]),
    vtodo('t3', ['SUMMARY:Oil the vice', 'STATUS:COMPLETED', 'COMPLETED:20261110T090000Z']),
    vtodo('t4', ['SUMMARY:Order a new blade', 'STATUS:CANCELLED']),
    vtodo('t5', [
      'SUMMARY:Return the borrowed clamps',
      `ATTENDEE:mailto:${OTHER}`,
      'URL:https://notes.invalid/t5',
    ]),
    vtodo('t6', ['SUMMARY:Tidy the offcuts', 'STATUS:WAITING']),
  ],
  garden: [vtodo('g1', ['SUMMARY:Order seed potatoes', 'DUE:20270115T090000Z'])],
};

const backend = () =>
  createFakeBackend(
    [calendar('shop', 'reminder', 'Workshop'), calendar('garden', 'reminder', 'Garden')],
    ITEMS,
  );

const source = () => createVtodoBoardSource(backend(), { id: 'home', identity: { addresses: [ME] } });

const card = async (uid: string) => {
  const board = (await source().listBoards())[0];
  const page = await source().listCards(board, { mine: 'all', includeClosed: true });
  const found = (page.kind === 'changed' ? page.cards : []).find((entry) => entry.ref.id === uid);
  if (!found) throw new Error(`no card ${uid}`);
  return found;
};

export default async () => {
  await describe('BoardSource contract (VTODO task lists)', async () => {
    for (const check of boardSourceContract(source)) {
      await it(check.name, async () => {
        await check.run();
      });
    }
  });

  await describe('VTODO board source', async () => {
    await it('reports task lists as boards, with no web page to link to', async () => {
      const boards = await source().listBoards();
      expect(boards.length).toBe(2);
      expect(boards[0].id).toBe('shop');
      expect(boards[0].title).toBe('Workshop');
      expect(boards[0].source).toBe('home');
      expect(boards[0].url).toBe(null);
    });

    await it('says what a task list cannot do instead of pretending', async () => {
      const info = source().describe();
      expect(info.type).toBe('vtodo');
      expect(info.canWrite).toBe(false);
      expect(info.hasWatchers).toBe(false);
      expect(info.changeToken).toBe(false);
    });

    await it('uses STATUS as the column, verbatim', async () => {
      expect((await card('t1')).sourceColumn).toBe('NEEDS-ACTION');
      expect((await card('t2')).sourceColumn).toBe('IN-PROCESS');
      expect((await card('t3')).sourceColumn).toBe('COMPLETED');
      expect((await card('t4')).sourceColumn).toBe('CANCELLED');
    });

    await it('reads a task with no STATUS as needs-action, per RFC 5545', async () => {
      expect((await card('t5')).sourceColumn).toBe('NEEDS-ACTION');
    });

    await it('keeps a STATUS this build does not know, and lists it as a column', async () => {
      expect((await card('t6')).sourceColumn).toBe('WAITING');
      const board = (await source().listBoards())[0];
      const columns = await source().listColumns(board);
      const waiting = columns.find((column) => column.name === 'WAITING');
      expect(waiting !== undefined).toBe(true);
      expect(waiting?.closed).toBe(null);
    });

    await it('reports the lanes as columns even where no task sits', async () => {
      const board = (await source().listBoards())[1];
      const names = (await source().listColumns(board)).map((column) => column.name).join(',');
      expect(names).toBe('BACKLOG,NEEDS-ACTION,IN-PROCESS,COMPLETED,CANCELLED');
    });

    await it('calls completed and cancelled tasks closed, and keeps them out by default', async () => {
      expect((await card('t3')).closed).toBe(true);
      expect((await card('t4')).closed).toBe(true);
      expect((await card('t1')).closed).toBe(false);
      const board = (await source().listBoards())[0];
      const page = await source().listCards(board, { mine: 'all' });
      const ids = (page.kind === 'changed' ? page.cards : []).map((entry) => entry.ref.id).join(',');
      expect(ids).toBe('t1,t2,t5,t6');
    });

    await it('treats an unassigned task as the list owner own, an attendee as who it names', async () => {
      const own = await card('t1');
      expect(own.assignees.length).toBe(1);
      expect(own.assignees[0].isMe).toBe(true);
      const mine = await card('t2');
      expect(mine.assignees[0].isMe).toBe(true);
      expect(mine.assignees[0].displayName).toBe('Pat');
      const theirs = await card('t5');
      expect(theirs.assignees[0].isMe).toBe(false);
      expect(theirs.assignees[0].id).toBe(OTHER);
    });

    await it('answers "assigned" without the tasks handed to someone else', async () => {
      const board = (await source().listBoards())[0];
      const page = await source().listCards(board, { includeClosed: true });
      const ids = (page.kind === 'changed' ? page.cards : []).map((entry) => entry.ref.id).join(',');
      expect(ids).toBe('t1,t2,t3,t4,t6');
    });

    await it('matches an attendee whatever its case and mailto prefix', async () => {
      const shouty = createVtodoBoardSource(backend(), {
        id: 'home',
        identity: { addresses: [`MAILTO:${ME.toUpperCase()}`] },
      });
      const board = (await shouty.listBoards())[0];
      const page = await shouty.listCards(board, { mine: 'assigned' });
      const ids = (page.kind === 'changed' ? page.cards : []).map((entry) => entry.ref.id).join(',');
      expect(ids.includes('t2')).toBe(true);
    });

    await it('takes nobody for me when no identity is configured', async () => {
      const anonymous = createVtodoBoardSource(backend(), { id: 'home' });
      const board = (await anonymous.listBoards())[0];
      const page = await anonymous.listCards(board, { mine: 'assigned' });
      const ids = (page.kind === 'changed' ? page.cards : []).map((entry) => entry.ref.id).join(',');
      expect(ids).toBe('t1,t6');
    });

    await it('carries due, categories, url and the last change across', async () => {
      const lamp = await card('t2');
      expect(lamp.labels.map((label) => label.name).join(',')).toBe('shop,electrics');
      expect(lamp.labels[0].color).toBe(null);
      expect(lamp.updated).toBe('2026-11-18T08:00:00Z');
      expect(lamp.watchedByMe).toBe(null);
      expect((await card('t1')).due).toBe('2026-12-01');
      expect((await card('t5')).url).toBe('https://notes.invalid/t5');
      expect((await card('t1')).url).toBe(null);
    });

    await it('refuses a task list the backend does not have', async () => {
      const absent = { source: 'home', id: 'nope', title: 'absent', url: null };
      let message = '';
      try {
        await source().listCards(absent);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message.includes('nope')).toBe(true);
    });
  });
};
