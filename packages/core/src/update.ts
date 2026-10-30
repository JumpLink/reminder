/**
 * The update path: route → grant → calendar check → read → rewrite → conditional write.
 *
 * Same shape as `create.ts`, and for the same reason: the grant check lives inside the only
 * function that writes, so no frontend can forget it. Updating is a separate capability from
 * creating — `reminder.create` lets something add work to a list, `reminder.update` lets it
 * change or close work that is already there, and those are different amounts of trust.
 *
 * The read hands back an etag, and the write hands it straight back to the backend. Between the
 * two, someone else may have edited the same task; a backend that can tell says so
 * (`ConflictError`) instead of overwriting their edit with text computed from a stale copy.
 */

import type { CalendarBackend } from './backend.ts';
import type { ReminderConfig } from './config.ts';
import { ReminderError } from './errors.ts';
import { requireGrant } from './grants.ts';
import { readReminder } from './ical.ts';
import { resolveTarget } from './routing.ts';
import { buildReminderUpdate, type ReminderChanges } from './rewrite.ts';
import type { ReminderItem } from './types.ts';
import { _, fmt } from './i18n.ts';

export interface UpdateDeps {
  backend: CalendarBackend;
  config: Pick<ReminderConfig, 'grants' | 'routes' | 'defaults'>;
  now?: () => Date;
}

export interface UpdateReminderInput extends ReminderChanges {
  /** Task list uid; the default reminder list when absent. */
  calendar?: string;
  uid: string;
}

export interface UpdateResult {
  uid: string;
  calendarUid: string;
  /** The task as it now reads back, so a caller need not fetch it again. */
  reminder: ReminderItem | null;
}

export async function updateReminder(deps: UpdateDeps, input: UpdateReminderInput): Promise<UpdateResult> {
  const { calendar, uid, ...changes } = input;
  const target = resolveTarget(deps.config, { kind: 'reminder', calendar });
  requireGrant(deps.config.grants, 'reminder.update', target);

  const calendars = await deps.backend.listCalendars('reminder');
  if (!calendars.some((c) => c.uid === target)) {
    throw new ReminderError(fmt(_('no enabled task list "{uid}"'), { uid: target }));
  }

  const stored = await deps.backend.getItem(target, 'reminder', uid);
  if (stored === null) {
    throw new ReminderError(fmt(_('no reminder {uid} in "{target}"'), { uid, target }));
  }

  const now = deps.now?.() ?? new Date();
  const ical = buildReminderUpdate(stored.ical, changes, now);
  await deps.backend.updateItem(target, 'reminder', uid, ical, stored.etag);
  return { uid, calendarUid: target, reminder: readReminder(ical, target) };
}
