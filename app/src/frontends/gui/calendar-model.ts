/**
 * The calendar view's state, without Gtk so it runs under Node tests: the event calendars, and the
 * occurrences inside one visible window.
 *
 * Expansion runs per calendar rather than over the multiplexed backend, so a source that cannot be
 * read is a line beside the events the others still have (ADR 0005) instead of an empty month. The
 * expander's shared window cache makes the repeat cheap: a month revisited re-expands nothing.
 */

import { _, errorMessage, type CalendarBackend, type CalendarInfo } from '@reminder/core';

import { expandEvents, type ExpandedOccurrence } from '../../core/expand-events.ts';

/** A source that did not answer, named the way the overview names it. */
export interface CalendarFailure {
  name: string;
  message: string;
}

export interface CalendarLoad {
  occurrences: ExpandedOccurrence[];
  failures: CalendarFailure[];
  /** Instances dropped because one calendar hit the per-call cap. */
  omitted: number;
}

export interface CalendarModelDeps {
  /** Multiplexed, disabled sources already cut — what `Context.backend()` returns. */
  backend: CalendarBackend;
  now?: () => Date;
}

export interface CalendarModel {
  /** Event calendars only; task lists have no place in a calendar grid. */
  calendars(): CalendarInfo[];
  calendar(uid: string): CalendarInfo | null;
  /** Both bounds are `YYYY-MM-DD` and inclusive, the way the view counts days. */
  load(range: { from: string; to: string }): Promise<CalendarLoad>;
}

export function createCalendarModel(deps: CalendarModelDeps): CalendarModel {
  const now = deps.now ?? (() => new Date());
  let calendars: CalendarInfo[] = [];

  const listCalendars = async (): Promise<CalendarInfo[]> => {
    calendars = (await deps.backend.listCalendars('event')).filter((c) => c.kind === 'event');
    return calendars;
  };

  return {
    calendars: () => [...calendars],
    calendar: (uid) => calendars.find((c) => c.uid === uid) ?? null,

    async load(range) {
      const sources = calendars.length > 0 ? calendars : await listCalendars();
      const at = now();
      const results = await Promise.all(
        sources.map(async (c): Promise<CalendarLoad> => {
          try {
            const result = await expandEvents(deps.backend, { ...range, calendar: c.uid }, at);
            return { occurrences: result.occurrences, failures: [], omitted: result.omitted };
          } catch (err) {
            return {
              occurrences: [],
              failures: [{ name: c.name || _('Untitled'), message: errorMessage(err) }],
              omitted: 0,
            };
          }
        }),
      );
      return {
        occurrences: results.flatMap((r) => r.occurrences),
        failures: results.flatMap((r) => r.failures),
        omitted: results.reduce((sum, r) => sum + r.omitted, 0),
      };
    },
  };
}
