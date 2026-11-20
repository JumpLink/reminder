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

/**
 * Who "me" is while the demo runs — an invented person, so a board can hold cards that are
 * somebody else's and the "mine" filter has something to leave out. A task list has no server
 * identity to ask, so this is what a real setup would configure.
 */
export const DEMO_IDENTITY = {
  id: 'alex@example.org',
  displayName: 'Alex Sommer',
  addresses: ['alex@example.org'],
} as const;

/** The other two invented people the demo's cards are shared with. */
export const DEMO_PEOPLE = {
  ines: { name: 'Ines Falk', address: 'ines@example.org' },
  jonas: { name: 'Jonas Reiter', address: 'jonas@example.org' },
} as const;

export const DEMO_LISTS: readonly DemoList[] = [
  { account: 'home', uid: 'tasks', name: 'Tasks', readOnly: false },
  { account: 'home', uid: 'groceries', name: 'Groceries', readOnly: false },
  { account: 'work', uid: 'tasks', name: 'Tasks', readOnly: false },
  { account: 'work', uid: 'reading', name: 'Reading list', readOnly: true },
];

/** The one invented event calendar; it lives on the first account. */
export const DEMO_EVENT_CALENDAR = { account: 'home', uid: 'family', name: 'Family' } as const;

export const demoCalendars = (account: string): CalendarInfo[] => {
  const name = DEMO_ACCOUNTS.find((a) => a.id === account)?.name ?? null;
  const lists: CalendarInfo[] = DEMO_LISTS.filter((l) => l.account === account).map((l) => ({
    uid: l.uid,
    name: l.name,
    kind: 'reminder',
    backend: 'demo',
    account: name,
  }));
  if (account === DEMO_EVENT_CALENDAR.account)
    lists.push({
      uid: DEMO_EVENT_CALENDAR.uid,
      name: DEMO_EVENT_CALENDAR.name,
      kind: 'event',
      backend: 'demo',
      account: name,
    });
  return lists;
};

interface DemoAttendee {
  name: string;
  address: string;
}

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
  /**
   * The `STATUS` to write instead of `NEEDS-ACTION`, so the board has a card in every lane:
   * `BACKLOG` is not an RFC 5545 value and lands in the backlog lane by name (ADR 0008).
   */
  status?: 'BACKLOG' | 'IN-PROCESS';
  /** `ATTENDEE` lines. Without any, the task is whoever's list it is — see the VTODO adapter. */
  attendees?: readonly DemoAttendee[];
  /** `CATEGORIES`, drawn as the card's labels. */
  labels?: readonly string[];
  /** `URL` — what "Open in original" opens. */
  url?: string;
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
  // From here on the board's lanes: a backlog and an in-progress card per account, cards that
  // belong to somebody else, labels, and one card with a page of its own.
  {
    list: 'home:tasks',
    uid: 'd10',
    summary: 'Plan the bathroom retiling',
    status: 'BACKLOG',
    labels: ['home'],
  },
  {
    list: 'home:tasks',
    uid: 'd11',
    summary: 'Fix the squeaking garden gate',
    status: 'IN-PROCESS',
    due: 2,
    labels: ['repair'],
  },
  {
    list: 'work:tasks',
    uid: 'w05',
    summary: 'Draft the studio newsletter',
    status: 'IN-PROCESS',
    due: 1,
    labels: ['writing'],
    attendees: [{ name: DEMO_IDENTITY.displayName, address: DEMO_IDENTITY.addresses[0] }, DEMO_PEOPLE.ines],
  },
  {
    list: 'work:tasks',
    uid: 'w06',
    summary: 'Collect feedback on the new logo',
    status: 'BACKLOG',
    labels: ['design'],
  },
  {
    list: 'work:tasks',
    uid: 'w07',
    summary: 'Hand over the print files',
    due: 4,
    labels: ['print'],
    attendees: [DEMO_PEOPLE.jonas],
  },
  {
    list: 'work:reading',
    uid: 'r03',
    summary: 'Read the notes on adaptive layouts',
    labels: ['reading'],
    url: 'https://example.org/notes/adaptive-layouts',
  },
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
  if (task.url) lines.push(`URL:${task.url}`);
  if (task.labels?.length) lines.push(`CATEGORIES:${task.labels.join(',')}`);
  for (const attendee of task.attendees ?? [])
    lines.push(`ATTENDEE;CN=${attendee.name}:mailto:${attendee.address}`);
  if (task.doneAgo !== undefined) {
    const finished = new Date(now.getTime() - task.doneAgo * 24 * 60 * 60 * 1000);
    lines.push('STATUS:COMPLETED', `COMPLETED:${utcStamp(finished)}`);
  } else lines.push(`STATUS:${task.status ?? 'NEEDS-ACTION'}`);
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

interface DemoEvent {
  uid: string;
  summary: string;
  /** Whole days from today. */
  day: number;
  /** Local start and end as `HHMM`; without them the event is all-day. */
  from?: string;
  to?: string;
  /** All-day length in days; 1 unless a trip spans more. */
  days?: number;
  location?: string;
  /** `URL` — what "Open the original" opens. */
  url?: string;
  /** Written as the event's TZID. `Europe/Nowhere` resolves nowhere, on purpose (ADR 0009). */
  tzid?: string;
}

/**
 * A month around today, so every mode has something to draw: timed events at different hours, an
 * all-day marker, a trip over several days, and one event whose zone cannot be resolved.
 */
const EVENTS: readonly DemoEvent[] = [
  { uid: 'e10', summary: 'Dentist', day: -6, from: '1115', to: '1200', location: 'Rosenweg 4' },
  { uid: 'e11', summary: 'Swimming', day: -2, from: '0700', to: '0800', location: 'Stadtbad' },
  { uid: 'e12', summary: 'Lunch with Ines', day: 0, from: '1230', to: '1330', location: 'Café Hain' },
  {
    uid: 'e13',
    summary: 'Film night',
    day: 1,
    from: '2000',
    to: '2215',
    location: 'Kino Central',
    url: 'https://example.org/kino/programm',
  },
  { uid: 'e14', summary: 'Bin day', day: 2 },
  {
    uid: 'e15',
    summary: 'Partner call',
    day: 2,
    from: '1400',
    to: '1500',
    tzid: 'Europe/Nowhere',
    url: 'https://example.org/meet/partner-call',
  },
  { uid: 'e16', summary: 'Trip to the coast', day: 4, days: 3, location: 'Greetsiel' },
  { uid: 'e17', summary: 'Repair café', day: 9, from: '1500', to: '1800', location: 'Werkstatt Nord' },
  { uid: 'e18', summary: "Mum's birthday", day: 12 },
  { uid: 'e19', summary: 'Choir rehearsal', day: 15, from: '1930', to: '2130', location: 'Gemeindehaus' },
  { uid: 'e20', summary: 'Garden club', day: 21, from: '1000', to: '1200', location: 'Kleingarten 12' },
];

function vevent(event: DemoEvent, now: Date): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:demo-${event.uid}`,
    `DTSTAMP:${utcStamp(now)}`,
    `SUMMARY:${event.summary}`,
  ];
  if (event.from && event.to) {
    const zone = event.tzid ? `;TZID=${event.tzid}` : '';
    lines.push(
      `DTSTART${zone}:${day(now, event.day)}T${event.from}00`,
      `DTEND${zone}:${day(now, event.day)}T${event.to}00`,
    );
  } else {
    lines.push(
      `DTSTART;VALUE=DATE:${day(now, event.day)}`,
      `DTEND;VALUE=DATE:${day(now, event.day + (event.days ?? 1))}`,
    );
  }
  if (event.location) lines.push(`LOCATION:${event.location}`);
  if (event.url) lines.push(`URL:${event.url}`);
  lines.push('END:VEVENT');
  return lines;
}

/**
 * The invented calendar: a month of single events (see {@link EVENTS}) plus two recurring ones in
 * floating local time, so they read the same in every zone — a daily stand-up that skips tomorrow
 * (EXDATE), and a weekly lesson whose instance today was moved (a `RECURRENCE-ID` override). Both
 * started before today, so only expansion can show them.
 */
export function demoEvents(account: string, now: Date): Record<string, string[]> {
  if (account !== DEMO_EVENT_CALENDAR.account) return {};
  const wrap = (...components: string[][]): string =>
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//reminder demo//EN',
      ...components.flat(),
      'END:VCALENDAR',
      '',
    ].join('\r\n');
  const stamp = `DTSTAMP:${utcStamp(now)}`;
  const standup = [
    'BEGIN:VEVENT',
    'UID:demo-e01',
    stamp,
    'SUMMARY:Morning stand-up',
    `DTSTART:${day(now, -3)}T093000`,
    `DTEND:${day(now, -3)}T094500`,
    'RRULE:FREQ=DAILY',
    `EXDATE:${day(now, 1)}T093000`,
    'END:VEVENT',
  ];
  const lesson = [
    'BEGIN:VEVENT',
    'UID:demo-e02',
    stamp,
    'SUMMARY:Piano lesson',
    `DTSTART:${day(now, -14)}T170000`,
    `DTEND:${day(now, -14)}T180000`,
    'RRULE:FREQ=WEEKLY',
    'END:VEVENT',
  ];
  const moved = [
    'BEGIN:VEVENT',
    'UID:demo-e02',
    stamp,
    'SUMMARY:Piano lesson, room 2',
    `RECURRENCE-ID:${day(now, 0)}T170000`,
    `DTSTART:${day(now, 0)}T183000`,
    `DTEND:${day(now, 0)}T193000`,
    'END:VEVENT',
  ];
  return {
    [DEMO_EVENT_CALENDAR.uid]: [
      wrap(standup),
      wrap(lesson, moved),
      ...EVENTS.map((e) => wrap(vevent(e, now))),
    ],
  };
}
