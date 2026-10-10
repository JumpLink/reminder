/**
 * `reminder events` — events with an occurrence in a window.
 */

import type { CommandModule } from 'yargs';

import { EVENT_LIMIT, EVENT_WINDOW_DAYS, listEvents } from '@reminder/core';

import { createContext } from '../../core/context.ts';
import { dim, omittedLine, pickArgv, printJson, runAndExit, shortTime } from './output.ts';

export const eventsCommand: CommandModule = {
  command: 'events',
  describe: 'List events in a time window',
  builder: (yargs) =>
    yargs
      .option('from', { type: 'string', describe: 'YYYY-MM-DD or ISO time (default: today, UTC)' })
      .option('to', {
        type: 'string',
        describe: `YYYY-MM-DD (inclusive) or ISO time (default: from + ${EVENT_WINDOW_DAYS} days)`,
      })
      .option('calendar', { type: 'string', describe: 'One calendar uid (see `reminder calendars`)' })
      .option('limit', {
        type: 'number',
        describe: `Max events (default ${EVENT_LIMIT.default}, max ${EVENT_LIMIT.max})`,
      })
      .option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const asJson = pickArgv<boolean>(raw, 'json') ?? false;
    runAndExit(
      () =>
        listEvents(createContext().backend(), {
          from: pickArgv<string>(raw, 'from'),
          to: pickArgv<string>(raw, 'to'),
          calendar: pickArgv<string>(raw, 'calendar'),
          limit: pickArgv<number>(raw, 'limit'),
        }),
      (result) => {
        if (asJson) return printJson(result);
        if (result.events.length === 0) console.log(`No events between ${result.from} and ${result.to}.`);
        for (const e of result.events) {
          const end = e.end && !e.allDay ? ` – ${shortTime(e.end)}` : '';
          const marks = [e.allDay ? 'all day' : null, e.recurring ? 'recurring' : null]
            .filter(Boolean)
            .join(', ');
          console.log(
            `${shortTime(e.start)}${end}  ${e.summary ?? '(no title)'}${marks ? dim(` (${marks})`) : ''}`,
          );
          if (e.location) console.log(dim(`    ${e.location}`));
        }
        const more = omittedLine(result.omitted, '--limit');
        if (more) console.log(more);
      },
    );
  },
};
