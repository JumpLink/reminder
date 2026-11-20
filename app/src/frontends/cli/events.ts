/**
 * `reminder events` — events with an occurrence in a window.
 */

import type { CommandModule } from 'yargs';

import { _, EVENT_LIMIT, EVENT_WINDOW_DAYS, EXPAND_WINDOW_MAX_DAYS, fmt, listEvents } from '@reminder/core';

import { createContext } from '../../core/context.ts';
import { expandEvents } from '../../core/expand-events.ts';
import { dim, omittedLine, pickArgv, printJson, runAndExit, shortTime } from './output.ts';

export const eventsCommand: CommandModule = {
  command: 'events',
  describe: _('List events in a time window'),
  builder: (yargs) =>
    yargs
      .option('from', { type: 'string', describe: _('YYYY-MM-DD or ISO time (default: today, UTC)') })
      .option('to', {
        type: 'string',
        describe: fmt(_('YYYY-MM-DD (inclusive) or ISO time (default: from + {days} days)'), {
          days: EVENT_WINDOW_DAYS,
        }),
      })
      .option('calendar', { type: 'string', describe: _('One calendar uid (see `reminder calendars`)') })
      .option('limit', {
        type: 'number',
        describe: fmt(_('Max events (default {default}, max {max})'), {
          default: EVENT_LIMIT.default,
          max: EVENT_LIMIT.max,
        }),
      })
      .option('expand', {
        type: 'boolean',
        default: false,
        describe: fmt(_('List every instance of recurring events (window clamped to {days} days)'), {
          days: EXPAND_WINDOW_MAX_DAYS,
        }),
      })
      .option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const asJson = pickArgv<boolean>(raw, 'json') ?? false;
    const query = {
      from: pickArgv<string>(raw, 'from'),
      to: pickArgv<string>(raw, 'to'),
      calendar: pickArgv<string>(raw, 'calendar'),
      limit: pickArgv<number>(raw, 'limit'),
    };
    if (pickArgv<boolean>(raw, 'expand') === true) {
      runAndExit(
        () => expandEvents(createContext().backend(), query),
        (result) => {
          if (asJson) return printJson(result);
          if (result.clamped)
            console.log(
              dim(
                fmt(_('Window clamped to {days} days, ending {to}.'), {
                  days: EXPAND_WINDOW_MAX_DAYS,
                  to: result.to,
                }),
              ),
            );
          if (result.occurrences.length === 0)
            console.log(fmt(_('No events between {from} and {to}.'), { from: result.from, to: result.to }));
          for (const o of result.occurrences) {
            const marks = [
              o.allDay ? _('all day') : null,
              o.override ? _('moved') : null,
              o.zoneUnresolved ? fmt(_('time zone {zone} unknown'), { zone: o.tzid ?? '' }) : null,
            ]
              .filter(Boolean)
              .join(', ');
            console.log(
              `${shortTime(o.start)}  ${o.summary ?? _('(no title)')}${marks ? dim(` (${marks})`) : ''}`,
            );
          }
          for (const c of result.cuts)
            console.log(dim(fmt(_('{uid}: {cut} more instances cut'), { uid: c.uid, cut: c.cut })));
          const more = omittedLine(result.omitted, '--limit');
          if (more) console.log(more);
        },
      );
      return;
    }
    runAndExit(
      () => listEvents(createContext().backend(), query),
      (result) => {
        if (asJson) return printJson(result);
        if (result.events.length === 0)
          console.log(fmt(_('No events between {from} and {to}.'), { from: result.from, to: result.to }));
        for (const e of result.events) {
          const end = e.end && !e.allDay ? ` – ${shortTime(e.end)}` : '';
          const marks = [e.allDay ? _('all day') : null, e.recurring ? _('recurring') : null]
            .filter(Boolean)
            .join(', ');
          console.log(
            `${shortTime(e.start)}${end}  ${e.summary ?? _('(no title)')}${marks ? dim(` (${marks})`) : ''}`,
          );
          if (e.location) console.log(dim(`    ${e.location}`));
        }
        const more = omittedLine(result.omitted, '--limit');
        if (more) console.log(more);
      },
    );
  },
};
