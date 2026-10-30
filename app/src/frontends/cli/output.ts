/**
 * Shared CLI output: `--json` for pipes, a plain human rendering otherwise.
 */

import { _, fmt, type ReminderItem } from '@reminder/core';

export function printJson(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

/** Run a command's work, print it, exit. On GJS the exit also ends the main loop. */
export function runAndExit<T>(fn: () => Promise<T>, print: (value: T) => void = printJson): void {
  fn()
    .then(print)
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}

/** Read an option from yargs argv, trying each spelling — yargs exposes kebab-case as camelCase. */
export function pickArgv<T>(argv: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    const v = argv[key];
    if (v !== undefined && v !== null) return v as T;
  }
  return undefined;
}

const DIM = '\u001B[2m';
const RESET = '\u001B[0m';

/** Dim only when stdout is a terminal — a redirected file gets plain text. */
export function dim(text: string): string {
  return process.stdout.isTTY ? `${DIM}${text}${RESET}` : text;
}

/** `2026-10-12T08:00:00Z` → `2026-10-12 08:00Z`; a date stays a date. */
export function shortTime(iso: string): string {
  return iso.replace('T', ' ').replace(/:00(Z?)$/, '$1');
}

/** One reminder as a line: `[ ] Pay the invoice  due 2026-10-12 08:00Z`. */
export function reminderLine(r: Pick<ReminderItem, 'status' | 'summary' | 'due'>): string {
  const box = r.status === 'completed' ? '[x]' : r.status === 'cancelled' ? '[-]' : '[ ]';
  const due = r.due ? dim(fmt(_('  due {time}'), { time: shortTime(r.due) })) : '';
  return `${box} ${r.summary ?? _('(no title)')}${due}`;
}

export function omittedLine(omitted: number, flag: string): string | null {
  return omitted > 0 ? dim(fmt(_('… {omitted} more — raise {flag}'), { omitted, flag })) : null;
}
