/**
 * The write path: route → grant → calendar check → dedupe → create.
 *
 * The grant check is not a step a frontend remembers — it is inside the only function that
 * writes. CLI, MCP and any later UI reach the backend's `createItem` through here or not at all.
 *
 * Dedupe is a check and then a write, not one atomic operation: two creates with the same key
 * running at the same moment may both reach the backend. The deterministic UID makes the second
 * one collide there (a CalDAV server refuses an existing UID, EDS reports it), so concurrency
 * ends in an error, not a duplicate — but it is the backend that catches it, not this check.
 */

import type { CalendarBackend } from './backend.ts';
import type { ReminderConfig } from './config.ts';
import { InputError, ReminderError } from './errors.ts';
import { createCapability, requireGrant } from './grants.ts';
import { buildEvent, buildReminder, readEvent, readReminder } from './ical.ts';
import { resolveTarget } from './routing.ts';
import { sourceKey, uidForSourceKey } from './source-key.ts';
import type { ItemKind } from './types.ts';

export interface CreateDeps {
  backend: CalendarBackend;
  config: Pick<ReminderConfig, 'grants' | 'routes' | 'defaults'>;
  now?: () => Date;
}

interface CreateCommon {
  /** Explicit calendar / task list uid. Wins over `concern`. */
  calendar?: string;
  /** What the item is about; routed through `routes`, then `defaults`. */
  concern?: string;
  /** Where the item came from, e.g. `mail`; first half of the dedupe key. */
  source: string;
  /** That origin's id, e.g. a Message-ID; second half of the dedupe key. */
  sourceId: string;
  summary: string;
  description?: string;
}

export interface CreateEventInput extends CreateCommon {
  /** YYYY-MM-DD for all-day, otherwise ISO-8601 with an offset or Z. */
  start: string;
  end?: string;
  location?: string;
}

export interface CreateReminderInput extends CreateCommon {
  due?: string;
}

export interface CreateResult {
  /** False when an item with the same source key already existed; nothing was written. */
  created: boolean;
  uid: string;
  calendarUid: string;
  source: string;
}

async function prepare(deps: CreateDeps, kind: ItemKind, input: CreateCommon) {
  if (input.summary.trim() === '') throw new InputError('summary must not be empty');
  const key = sourceKey(input.source, input.sourceId);
  const target = resolveTarget(deps.config, { kind, calendar: input.calendar, concern: input.concern });
  requireGrant(deps.config.grants, createCapability(kind), target);

  const calendars = await deps.backend.listCalendars(kind);
  if (!calendars.some((c) => c.uid === target)) {
    throw new ReminderError(`no enabled ${kind === 'event' ? 'calendar' : 'task list'} "${target}"`);
  }

  const uid = uidForSourceKey(key);
  const existing = await deps.backend.getItem(target, kind, uid);
  if (existing !== null) {
    const stored =
      kind === 'event' ? readEvent(existing, target)?.source : readReminder(existing, target)?.source;
    if (stored !== key) {
      throw new ReminderError(
        `UID ${uid} already exists in "${target}" with a different source — refusing to merge`,
      );
    }
    return {
      key,
      target,
      uid,
      done: { created: false, uid, calendarUid: target, source: key } as CreateResult,
    };
  }
  return { key, target, uid, done: null };
}

export async function createEvent(deps: CreateDeps, input: CreateEventInput): Promise<CreateResult> {
  const { key, target, uid, done } = await prepare(deps, 'event', input);
  if (done) return done;
  const now = deps.now?.() ?? new Date();
  const ical = buildEvent({ ...input, uid, source: key }, now);
  const stored = await deps.backend.createItem(target, 'event', ical);
  return { created: true, uid: stored || uid, calendarUid: target, source: key };
}

export async function createReminder(deps: CreateDeps, input: CreateReminderInput): Promise<CreateResult> {
  const { key, target, uid, done } = await prepare(deps, 'reminder', input);
  if (done) return done;
  const now = deps.now?.() ?? new Date();
  const ical = buildReminder({ ...input, uid, source: key }, now);
  const stored = await deps.backend.createItem(target, 'reminder', ical);
  return { created: true, uid: stored || uid, calendarUid: target, source: key };
}
