/**
 * The demo's invented data: two accounts, four task lists, a spread of reminders. Every date is
 * relative to `now`, so a screenshot taken on any day shows the same agenda. Nothing here is real.
 */

import type { CalendarInfo } from '@reminder/core';

export interface DemoAccount {
  id: string;
  /** Shown as the list's account name; also what tells the two "Tasks" lists apart. */
  name: string;
}

export interface DemoList {
  account: string;
  uid: string;
  name: string;
  /** No grant: the list can be read, never changed. */
  readOnly: boolean;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
  { id: 'home', name: 'Family cloud' },
  { id: 'work', name: 'Studio' },
];

export const DEMO_LISTS: readonly DemoList[] = [
  { account: 'home', uid: 'tasks', name: 'Tasks', readOnly: false },
  { account: 'home', uid: 'groceries', name: 'Groceries', readOnly: false },
  { account: 'work', uid: 'tasks', name: 'Tasks', readOnly: false },
  { account: 'work', uid: 'reading', name: 'Reading list', readOnly: true },
];

export const demoCalendars = (account: string): CalendarInfo[] => {
  const name = DEMO_ACCOUNTS.find((a) => a.id === account)?.name ?? null;
  return DEMO_LISTS.filter((l) => l.account === account).map((l) => ({
    uid: l.uid,
    name: l.name,
    kind: 'reminder',
    backend: 'demo',
    account: name,
  }));
};

interface DemoTask {
  list: string;
  uid: string;
  summary: string;
  description?: string;
  /** Whole days from today; with `time` it is a local time of that day. */
  due?: number;
  time?: string;
  priority?: number;
  /** Completed this many days ago. */
  doneAgo?: number;
}

const TASKS: readonly DemoTask[] = [
  { list: 'home:tasks', uid: 'd01', summary: 'Renew library card', due: -3, priority: 5 },
  {
    list: 'home:tasks',
    uid: 'd02',
    summary: 'Call the plumber',
    description: 'The kitchen tap still drips. Ask for a visit this week.',
    due: -1,
    priority: 1,
  },
  { list: 'home:tasks', uid: 'd03', summary: 'Pick up the parcel', due: 0, time: '1700', priority: 5 },
  { list: 'home:tasks', uid: 'd04', summary: 'Book a dentist appointment', due: 0 },
  {
    list: 'home:tasks',
    uid: 'd05',
    summary: 'Plan the weekend hike',
    description: 'Check the train times and pack the thermos.',
    due: 3,
    priority: 9,
  },
  { list: 'home:tasks', uid: 'd06', summary: 'Back up the photos', due: 6 },
  { list: 'home:tasks', uid: 'd07', summary: 'Renew bike insurance', due: 30, priority: 5 },
  { list: 'home:tasks', uid: 'd08', summary: 'Sort out the garage' },
  { list: 'home:tasks', uid: 'd09', summary: 'Update the address book', due: -4, doneAgo: 2 },
  { list: 'home:groceries', uid: 'g01', summary: 'Oat milk', due: 0 },
  { list: 'home:groceries', uid: 'g02', summary: 'Coffee beans', due: 1, priority: 5 },
  { list: 'home:groceries', uid: 'g03', summary: 'Tomatoes' },
  { list: 'home:groceries', uid: 'g04', summary: 'Olive oil', doneAgo: 1 },
  {
    list: 'work:tasks',
    uid: 'w01',
    summary: 'Review the draft proposal',
    description: 'Comments on the budget section are due before the call.',
    due: -2,
    priority: 1,
  },
  { list: 'work:tasks', uid: 'w02', summary: 'Send invoice reminders', due: 2, priority: 5 },
  { list: 'work:tasks', uid: 'w03', summary: 'Prepare the quarterly slides', due: 14 },
  { list: 'work:tasks', uid: 'w04', summary: 'Submit the expense report', due: -6, doneAgo: 3 },
  { list: 'work:reading', uid: 'r01', summary: 'Read the accessibility guide' },
  { list: 'work:reading', uid: 'r02', summary: 'Skim the release notes', due: 5, priority: 9 },
];

const pad = (n: number): string => String(n).padStart(2, '0');

function day(now: Date, offset: number): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function utcStamp(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function vtodo(task: DemoTask, now: Date): string {
  const lines = [
    'BEGIN:VTODO',
    `UID:demo-${task.uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `SUMMARY:${task.summary}`,
  ];
  if (task.description) lines.push(`DESCRIPTION:${task.description.replace(/,/g, '\\,')}`);
  if (task.due !== undefined) {
    lines.push(
      task.time ? `DUE:${day(now, task.due)}T${task.time}00` : `DUE;VALUE=DATE:${day(now, task.due)}`,
    );
  }
  if (task.priority) lines.push(`PRIORITY:${task.priority}`);
  if (task.doneAgo !== undefined) {
    const finished = new Date(now.getTime() - task.doneAgo * 24 * 60 * 60 * 1000);
    lines.push('STATUS:COMPLETED', `COMPLETED:${utcStamp(finished)}`);
  } else lines.push('STATUS:NEEDS-ACTION');
  lines.push('END:VTODO', '');
  return lines.join('\r\n');
}

/** The reminders of one account's lists as iCalendar text, keyed by the list's bare uid. */
export function demoReminders(account: string, now: Date): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const task of TASKS) {
    const [owner, uid] = task.list.split(':');
    if (owner !== account) continue;
    (out[uid] ??= []).push(vtodo(task, now));
  }
  return out;
}
