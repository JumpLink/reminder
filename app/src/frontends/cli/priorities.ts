/**
 * `reminder priorities` — the ranked priorities of the configured list with their open steps.
 */

import type { CommandModule } from 'yargs';

import { listPriorities, PRIORITY_LIMIT, type PriorityItem } from '@reminder/core';

import { createContext } from '../../core/context.ts';
import { dim, omittedLine, pickArgv, printJson, runAndExit, shortTime } from './output.ts';

function deadline(item: PriorityItem): string {
  if (item.due === null || item.daysToDeadline === null) return '';
  const days = item.daysToDeadline;
  const when = days < 0 ? `${-days} days overdue` : days === 0 ? 'today' : `in ${days} days`;
  return dim(`  due ${shortTime(item.due)} (${when})`);
}

export const prioritiesCommand: CommandModule = {
  command: 'priorities',
  describe: 'List priorities with their open steps (the list is `priorities.list` in the config)',
  builder: (yargs) =>
    yargs
      .option('limit', {
        type: 'number',
        describe: `Max priorities (default ${PRIORITY_LIMIT.default}, max ${PRIORITY_LIMIT.max})`,
      })
      .option('json', { type: 'boolean', default: false }),
  handler: (argv) => {
    const raw = argv as Record<string, unknown>;
    const asJson = pickArgv<boolean>(raw, 'json') ?? false;
    runAndExit(
      () => {
        const context = createContext();
        return listPriorities(context.backend(), {
          list: context.config().priorities.list,
          limit: pickArgv<number>(raw, 'limit'),
        });
      },
      (result) => {
        if (asJson) return printJson(result);
        if (result.priorities.length === 0) console.log('No open priorities.');
        for (const item of result.priorities) {
          const tie = item.tie ? dim('  (tied for top)') : '';
          console.log(`[${item.priority}] ${item.summary ?? '(no title)'}${deadline(item)}${tie}`);
          if (item.link) console.log(dim(`    ${item.link}`));
          for (const step of item.steps) {
            const age = step.daysOpen === null ? 'age unknown' : `open ${step.daysOpen} days`;
            console.log(`    ${step.nag ? '→' : '·'} ${step.summary ?? '(no title)'}${dim(`  ${age}`)}`);
          }
        }
        const more = omittedLine(result.omitted, '--limit');
        if (more) console.log(more);
      },
    );
  },
};
