/**
 * The CalendarBackend contract: what every backend must do the same way. Run against the fake and
 * against vdir, so a second implementation proves the port instead of re-describing it.
 */

import { describe, expect, it } from '@gjsify/unit';
import { BackendError, ConflictError, type CalendarBackend } from '@reminder/core';

import { vtodo } from './fake-backend.ts';

export interface ContractSubject {
  backend: CalendarBackend;
  /** A task list that exists and accepts writes. */
  calendarUid: string;
  cleanup(): Promise<void>;
}

async function rejects(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  return null;
}

export async function backendContract(name: string, make: () => Promise<ContractSubject>): Promise<void> {
  await describe(`${name}: CalendarBackend contract`, async () => {
    await it('lists its task list', async () => {
      const s = await make();
      try {
        const lists = await s.backend.listCalendars('reminder');
        expect(lists.some((c) => c.uid === s.calendarUid)).toBe(true);
        expect((await s.backend.listCalendars('event')).some((c) => c.uid === s.calendarUid)).toBe(false);
      } finally {
        await s.cleanup();
      }
    });

    await it('creates, reads back and lists an item', async () => {
      const s = await make();
      try {
        const uid = await s.backend.createItem(
          s.calendarUid,
          'reminder',
          vtodo('c-1', ['SUMMARY:Water plants']),
        );
        expect(uid).toBe('c-1');
        const got = await s.backend.getItem(s.calendarUid, 'reminder', 'c-1');
        expect(got?.ical.includes('SUMMARY:Water plants')).toBe(true);
        const items = await s.backend.listItems({ kind: 'reminder', calendarUid: s.calendarUid });
        expect(items.length).toBe(1);
        expect(await s.backend.getItem(s.calendarUid, 'reminder', 'nope')).toBe(null);
      } finally {
        await s.cleanup();
      }
    });

    await it('refuses a duplicate UID', async () => {
      const s = await make();
      try {
        await s.backend.createItem(s.calendarUid, 'reminder', vtodo('c-2', ['SUMMARY:A']));
        const err = await rejects(
          s.backend.createItem(s.calendarUid, 'reminder', vtodo('c-2', ['SUMMARY:B'])),
        );
        expect(err instanceof BackendError).toBe(true);
      } finally {
        await s.cleanup();
      }
    });

    await it('updates on the current etag, which then moves', async () => {
      const s = await make();
      try {
        await s.backend.createItem(s.calendarUid, 'reminder', vtodo('c-3', ['SUMMARY:Old']));
        const first = await s.backend.getItem(s.calendarUid, 'reminder', 'c-3');
        await s.backend.updateItem(
          s.calendarUid,
          'reminder',
          'c-3',
          vtodo('c-3', ['SUMMARY:New']),
          first?.etag,
        );
        const second = await s.backend.getItem(s.calendarUid, 'reminder', 'c-3');
        expect(second?.ical.includes('SUMMARY:New')).toBe(true);
        expect(second?.etag === first?.etag).toBe(false);
      } finally {
        await s.cleanup();
      }
    });

    await it('refuses a stale etag with ConflictError', async () => {
      const s = await make();
      try {
        await s.backend.createItem(s.calendarUid, 'reminder', vtodo('c-4', ['SUMMARY:Old']));
        const first = await s.backend.getItem(s.calendarUid, 'reminder', 'c-4');
        await s.backend.updateItem(
          s.calendarUid,
          'reminder',
          'c-4',
          vtodo('c-4', ['SUMMARY:Theirs']),
          first?.etag,
        );
        const err = await rejects(
          s.backend.updateItem(s.calendarUid, 'reminder', 'c-4', vtodo('c-4', ['SUMMARY:Mine']), first?.etag),
        );
        expect(err instanceof ConflictError).toBe(true);
      } finally {
        await s.cleanup();
      }
    });

    await it('refuses to update an item that does not exist', async () => {
      const s = await make();
      try {
        const err = await rejects(
          s.backend.updateItem(s.calendarUid, 'reminder', 'ghost', vtodo('ghost', [])),
        );
        expect(err instanceof BackendError).toBe(true);
      } finally {
        await s.cleanup();
      }
    });
  });
}
