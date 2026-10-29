/**
 * `reminder priorities` — the ranked priorities of the configured list with their open steps.
 */

import type { CommandModule } from 'yargs';

import { _, _n, fmt, listPriorities, PRIORITY_LIMIT, type PriorityItem } from '@reminder/core';

import { createContext } from '../../core/context.ts';
import { dim, omittedLine, pickArgv, printJson, runAndExit, shortTime } from './output.ts';

function deadline(item: PriorityItem): string {
  if (item.due === null || item.daysToDeadline === null) return '';
  const days = item.daysToDeadline;
  const when =
    days < 0
      ? fmt(_n('{n} day overdue', '{n} days overdue', -days), { n: -days })
      : days === 0
        ? _('today')
        : fmt(_n('in {n} day', 'in {n} days', days), { n: days });
  return dim(fmt(_('  due {time} ({when})'), { time: shortTime(item.due), when }));
}

export const prioritiesCommand: CommandModule = {
  command: 'priorities',
  describe: _('List priorities with their open steps (the list is `priorities.list` in the config)'),
  builder: (yargs) =>
    yargs
      .option('limit', {
        type: 'number',
        describe: fmt(_('Max priorities (default {default}, max {max})'), {
          default: PRIORITY_LIMIT.default,
          max: PRIORITY_LIMIT.max,
        }),
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
        if (result.priorities.length === 0) console.log(_('No open priorities.'));
        for (const item of result.priorities) {
          const tie = item.tie ? dim(_('  (tied for top)')) : '';
          console.log(`[${item.priority}] ${item.summary ?? _('(no title)')}${deadline(item)}${tie}`);
          if (item.link) console.log(dim(`    ${item.link}`));
          for (const step of item.steps) {
            const age =
              step.daysOpen === null
                ? _('age unknown')
                : fmt(_n('open {n} day', 'open {n} days', step.daysOpen), { n: step.daysOpen });
            console.log(`    ${step.nag ? '→' : '·'} ${step.summary ?? _('(no title)')}${dim(`  ${age}`)}`);
          }
        }
        const more = omittedLine(result.omitted, '--limit');
        if (more) console.log(more);
      },
    );
  },
};
