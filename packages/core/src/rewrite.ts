/**
 * Editing stored iCalendar text in place, without rewriting what was not edited.
 *
 * A VTODO on a real calendar carries more than reminder models: RRULE, VALARM children, the
 * originating client's X- properties, a CATEGORIES list, an ATTACH. Re-serialising the item from
 * `ReminderItem` would silently drop every one of them — the person would edit a due date and
 * lose their alarm. So an update is a LINE EDIT: the text is split into logical lines, the ones
 * an edit names are replaced or removed, and every other line is emitted with its original bytes,
 * including its original folding.
 *
 * Only properties directly on the target component are touched. A `SUMMARY` inside a nested
 * VALARM belongs to the alarm, not the task, and nesting depth is what tells them apart.
 */

import { InputError } from './errors.ts';
import {
  escapeText,
  findComponent,
  fold,
  formatUtc,
  parseComponents,
  parseContentLine,
  timeLine,
} from './ical.ts';
import type { ReminderStatus } from './types.ts';
import { _, fmt } from './i18n.ts';

/** Replace the property with `line`, or remove it entirely when `line` is null. */
export interface PropertyEdit {
  /** Property name, upper case. */
  name: string;
  /** The full content line to write, unfolded. Null removes every occurrence. */
  line: string | null;
}

interface LogicalLine {
  /** The original physical lines, joined, exactly as they arrived. */
  raw: string;
  name: string;
  /** Component nesting depth of the component this line belongs to. */
  depth: number;
  /** BEGIN / END / a property. */
  kind: 'begin' | 'end' | 'prop';
  /** For BEGIN and END: the component name. */
  component: string;
  removed: boolean;
}

/** Split into logical lines, keeping each one's raw text. A leading space or tab continues. */
function logicalLines(text: string, separator: string): LogicalLine[] {
  const out: LogicalLine[] = [];
  const physical = text.split(/\r?\n/);
  const raws: string[] = [];
  for (const line of physical) {
    if (/^[ \t]/.test(line) && raws.length > 0) raws[raws.length - 1] += separator + line;
    else raws.push(line);
  }
  let depth = 0;
  for (const raw of raws) {
    if (raw === '') continue;
    const unfolded = raw.replace(/\r?\n[ \t]/g, '');
    let parsed;
    try {
      parsed = parseContentLine(unfolded);
    } catch {
      // Not a content line at all. Keep it verbatim; it is not ours to repair.
      out.push({ raw, name: '', depth, kind: 'prop', component: '', removed: false });
      continue;
    }
    if (parsed.name === 'BEGIN') {
      out.push({ raw, name: 'BEGIN', depth, kind: 'begin', component: parsed.value.toUpperCase(), removed: false });
      depth++;
    } else if (parsed.name === 'END') {
      depth = Math.max(0, depth - 1);
      out.push({ raw, name: 'END', depth, kind: 'end', component: parsed.value.toUpperCase(), removed: false });
    } else {
      out.push({ raw, name: parsed.name, depth, kind: 'prop', component: '', removed: false });
    }
  }
  return out;
}

/**
 * Apply `edits` to the first `component` in `text` and return the whole text again.
 *
 * Lines no edit names keep their bytes. A replaced property stays where it was; a new one is
 * appended just before the component's END, in the order the edits were given.
 */
export function rewriteComponent(text: string, component: string, edits: readonly PropertyEdit[]): string {
  const separator = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = logicalLines(text, separator);

  const beginIndex = lines.findIndex((l) => l.kind === 'begin' && l.component === component);
  if (beginIndex < 0) throw new InputError(fmt(_('no {component} in the stored item'), { component }));
  const bodyDepth = lines[beginIndex].depth + 1;
  const endIndex = lines.findIndex((l, i) => i > beginIndex && l.kind === 'end' && l.component === component);
  if (endIndex < 0) throw new InputError(fmt(_('unterminated {component} in the stored item'), { component }));

  const appended: string[] = [];
  for (const edit of edits) {
    const matches: number[] = [];
    for (let i = beginIndex + 1; i < endIndex; i++) {
      const line = lines[i];
      if (line.kind === 'prop' && line.depth === bodyDepth && line.name === edit.name) matches.push(i);
    }
    if (edit.line === null) {
      for (const i of matches) lines[i].removed = true;
      continue;
    }
    const folded = fold(edit.line).replace(/\r\n/g, separator);
    if (matches.length === 0) appended.push(folded);
    else {
      lines[matches[0]].raw = folded;
      for (const i of matches.slice(1)) lines[i].removed = true;
    }
  }

  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i === endIndex) out.push(...appended);
    if (!lines[i].removed) out.push(lines[i].raw);
  }
  // A component is a complete line, so the text ends with a break; keep whichever way it did.
  return out.join(separator) + (/\r?\n$/.test(text) ? separator : '');
}

// ── reminders ──────────────────────────────────────────────────────────────

/** What an update may change. An absent field is untouched; see each field for how it clears. */
export interface ReminderChanges {
  summary?: string;
  /** An empty string removes the DESCRIPTION. */
  description?: string;
  /** `YYYY-MM-DD` or an ISO time with an offset; an empty string removes the DUE. */
  due?: string;
  /** 1 (highest) to 9; 0 removes the PRIORITY, which is what an undefined priority is. */
  priority?: number;
  status?: ReminderStatus;
}

/** Statuses a caller may set. `unknown` is something a foreign client wrote, not a target. */
const STATUS_VALUE: Partial<Record<ReminderStatus, string>> = {
  'needs-action': 'NEEDS-ACTION',
  'in-process': 'IN-PROCESS',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
};

export function isWritableStatus(value: unknown): value is ReminderStatus {
  return typeof value === 'string' && value in STATUS_VALUE;
}

function sequenceOf(ical: string): number {
  const comp = findComponent(parseComponents(ical), 'VTODO');
  const raw = comp?.props.find((p) => p.name === 'SEQUENCE')?.value;
  const n = raw === undefined ? 0 : Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * The stored VTODO with `changes` applied: the new text, ready to hand back to the backend.
 *
 * Every write bumps SEQUENCE and restamps DTSTAMP and LAST-MODIFIED, so another client can tell
 * that this revision is newer. Times the caller gives are normalised the same way a create does
 * — a bare date stays a DATE, anything else needs an explicit offset and becomes UTC. The time
 * zone of a stored DUE is never guessed.
 */
export function buildReminderUpdate(ical: string, changes: ReminderChanges, now: Date): string {
  const edits: PropertyEdit[] = [];

  if (changes.summary !== undefined) {
    if (changes.summary.trim() === '') throw new InputError(_('summary must not be empty'));
    edits.push({ name: 'SUMMARY', line: `SUMMARY:${escapeText(changes.summary)}` });
  }
  if (changes.description !== undefined) {
    edits.push({
      name: 'DESCRIPTION',
      line: changes.description === '' ? null : `DESCRIPTION:${escapeText(changes.description)}`,
    });
  }
  if (changes.due !== undefined) {
    edits.push({ name: 'DUE', line: changes.due === '' ? null : timeLine('DUE', changes.due) });
  }
  if (changes.priority !== undefined) {
    if (!Number.isInteger(changes.priority) || changes.priority < 0 || changes.priority > 9) {
      throw new InputError(fmt(_('priority must be 0 (none) to 9, not {value}'), { value: changes.priority }));
    }
    edits.push({ name: 'PRIORITY', line: changes.priority === 0 ? null : `PRIORITY:${changes.priority}` });
  }
  if (changes.status !== undefined) {
    const value = STATUS_VALUE[changes.status];
    if (!value) throw new InputError(fmt(_('cannot set status "{value}"'), { value: changes.status }));
    edits.push({ name: 'STATUS', line: `STATUS:${value}` });
    if (changes.status === 'completed') {
      edits.push({ name: 'PERCENT-COMPLETE', line: 'PERCENT-COMPLETE:100' });
      edits.push({ name: 'COMPLETED', line: `COMPLETED:${formatUtc(now)}` });
    } else {
      // Reopening drops the progress too; cancelling or suspending leaves it, because a
      // cancelled task that was 60 % done still was.
      edits.push({ name: 'COMPLETED', line: null });
      if (changes.status === 'needs-action') edits.push({ name: 'PERCENT-COMPLETE', line: null });
    }
  }

  if (edits.length === 0) throw new InputError(_('nothing to change'));

  const stamp = formatUtc(now);
  edits.push({ name: 'SEQUENCE', line: `SEQUENCE:${sequenceOf(ical) + 1}` });
  edits.push({ name: 'DTSTAMP', line: `DTSTAMP:${stamp}` });
  edits.push({ name: 'LAST-MODIFIED', line: `LAST-MODIFIED:${stamp}` });

  return rewriteComponent(ical, 'VTODO', edits);
}
