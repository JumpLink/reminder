// Live EDS round trip for docs/adr/0002: a priority and its steps, linked by
// `RELATED-TO;RELTYPE=PARENT`, written into a real task list and read back as priorities.
//
// Opt-in, not part of `gjsify test`: it needs a session bus with evolution-source-registry and
// evolution-calendar-factory, which the unit run deliberately hides. Run it with
// `app/tests/integration/eds-roundtrip.sh`, which gives it a private bus and private XDG dirs so
// it can never see — or touch — the calendars of the person running it.
import type EDataServer from 'gi://EDataServer?version=1.2';
import { formatUtc, listPriorities, readReminder, type CalendarBackend } from '@reminder/core';
import { createEdsBackend } from '@reminder/eds';
import assert from 'node:assert';
import GLib from 'gi://GLib?version=2.0';

const LIST_UID = 'reminder-test-priorities';
const NOW = new Date();
const DAY_MS = 86_400_000;

const ago = (days: number) => formatUtc(new Date(NOW.getTime() - days * DAY_MS));

function todo(uid: string, lines: string[]): string {
  return ['BEGIN:VTODO', `UID:${uid}`, `DTSTAMP:${formatUtc(NOW)}`, ...lines, 'END:VTODO', ''].join('\r\n');
}

async function createTaskList(): Promise<void> {
  const { default: lib } = await import('gi://EDataServer?version=1.2');
  const registry = lib.SourceRegistry.new_sync(null);
  const source = lib.Source.new_with_uid(LIST_UID, null);
  source.set_display_name('Priorities round trip');
  source.set_parent('local-stub');
  const ext = source.get_extension(lib.SOURCE_EXTENSION_TASK_LIST) as EDataServer.SourceBackend;
  ext.set_backend_name('local');
  registry.commit_source_sync(source, null);
}

async function waitForList(backend: CalendarBackend): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const lists = await backend.listCalendars('reminder');
    if (lists.some((c) => c.uid === LIST_UID)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.fail(`task list ${LIST_UID} never showed up in the registry`);
}

async function main(): Promise<void> {
  await createTaskList();
  const backend = createEdsBackend();
  await waitForList(backend);

  const parent = 'prio-lease';
  const link = (uid: string) => `RELATED-TO;RELTYPE=PARENT:${uid}`;
  for (const ical of [
    todo(parent, [
      'SUMMARY:Renew the studio lease',
      'PRIORITY:2',
      `DUE;VALUE=DATE:${formatUtc(new Date(NOW.getTime() + 20 * DAY_MS)).slice(0, 8)}`,
      'URL:https://wiki.example.org/cases/studio-lease',
      `CREATED:${ago(30)}`,
    ]),
    todo('step-old', ['SUMMARY:Call the landlord', link(parent), `CREATED:${ago(10)}`]),
    todo('step-new', ['SUMMARY:Send the signed copy', link(parent), `CREATED:${ago(3)}`]),
    todo('step-done', [
      'SUMMARY:Ask for the draft',
      link(parent),
      'STATUS:COMPLETED',
      `COMPLETED:${ago(20)}`,
      `CREATED:${ago(25)}`,
    ]),
    todo('step-orphan', ['SUMMARY:Parent was deleted', link('no-such-parent'), `CREATED:${ago(5)}`]),
  ]) {
    await backend.createItem(LIST_UID, 'reminder', ical);
  }

  // The link survives the store as text …
  const stored = await backend.getItem(LIST_UID, 'reminder', 'step-old');
  assert(stored, 'step-old not found after create');
  const item = readReminder(stored.ical, LIST_UID);
  assert.equal(item?.parent, parent, 'RELATED-TO;RELTYPE=PARENT did not round-trip through EDS');
  assert(item?.created, 'CREATED did not round-trip through EDS');

  // … and the core joins it back into a priority.
  const result = await listPriorities(backend, { list: LIST_UID });
  assert.equal(result.priorities.length, 1, 'orphan or step leaked in as a priority');
  const [p] = result.priorities;
  assert.equal(p.uid, parent);
  assert.equal(p.link, 'https://wiki.example.org/cases/studio-lease');
  assert.equal(p.daysToDeadline, 20);
  assert.deepEqual(
    p.steps.map((s) => s.uid),
    ['step-old', 'step-new'],
    'completed step or orphan counted, or order wrong',
  );
  assert.deepEqual(
    p.steps.map((s) => s.nag),
    [true, false],
  );
  assert.equal(p.daysOpen, 10, 'EDS changed CREATED, so the open-since clock is wrong');
  console.log('OK: RELATED-TO;RELTYPE=PARENT round-trips through EDS; priorities_list joins it');
}

// GJS has no always-on event loop and the ECal client connects through GLib callbacks, so the
// first createItem would wait forever without one. process.exit() ends it. GLib is a static import
// on purpose: a dynamic one from inside the running loop never resolves.
const loop = new GLib.MainLoop(null, false);
main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(1);
  },
);
loop.run();
