/**
 * The tasks view: open reminders in sections (overdue, today, upcoming, later, no date) and the
 * finished ones folded away. A row opens its detail in an `AdaptivePane` (inspector, dialog or
 * bottom sheet by size class). Completing, reopening and postponing go through the model, which
 * writes only where a grant exists — without one the row is read-only.
 */

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import { AdaptivePane, TaskRow } from '@gjsify/adwaita-extended';

import { _, fmt, type AgendaOccurrence, type ReminderItem, type ReminderStatus } from '@reminder/core';

import type { SizeClass } from '../constants.ts';
import type { TasksModel, WriteOutcome } from '../model.ts';
import { onSignal } from '../signals.ts';
import {
  buildVisibleAgenda,
  colourFor,
  describeSyncProblems,
  dueDate,
  occurrenceTime,
  sectionTitle,
  toRowData,
} from '../view-model.ts';

const escapeMarkup = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface TasksView {
  widget: Gtk.Widget;
  setSizeClass(sizeClass: SizeClass): void;
  setModel(model: TasksModel, hidden: ReadonlySet<string>): void;
  setHidden(hidden: ReadonlySet<string>): void;
  /** Replaces the list with a message, e.g. a configuration error. */
  setError(message: string): void;
  /** The sync line shown in the banner too, so it is visible while the overview is closed. */
  syncProblems(): string | null;
}

const STATUS_NAME: Record<ReminderStatus, () => string> = {
  'needs-action': () => _('Open'),
  'in-process': () => _('In progress'),
  completed: () => _('Completed'),
  cancelled: () => _('Cancelled'),
  unknown: () => _('Unknown'),
};

function detailRow(title: string, value: string): Adw.ActionRow {
  const row = new Adw.ActionRow({ title, subtitle: value, useMarkup: false, subtitleSelectable: true });
  row.add_css_class('property');
  return row;
}

function buildDetail(item: ReminderItem, listName: string): Gtk.Widget {
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
  for (const side of ['start', 'end', 'top', 'bottom'] as const) box[`set_margin_${side}`](18);
  const title = new Gtk.Label({
    label: item.summary ?? _('Untitled'),
    wrap: true,
    xalign: 0,
    selectable: true,
  });
  title.add_css_class('title-2');
  box.append(title);
  if (item.description)
    box.append(new Gtk.Label({ label: item.description, wrap: true, xalign: 0, selectable: true }));
  const rows = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE });
  rows.add_css_class('boxed-list');
  rows.append(detailRow(_('List'), listName));
  const due = dueDate(item);
  if (due) {
    const text =
      item.dueAllDay || /^\d{4}-\d{2}-\d{2}$/.test(item.due ?? '')
        ? due.toLocaleDateString(undefined, { dateStyle: 'medium' })
        : due.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    rows.append(detailRow(_('Due'), text));
  }
  rows.append(detailRow(_('Status'), STATUS_NAME[item.status]()));
  box.append(rows);
  return new Gtk.ScrolledWindow({ hscrollbarPolicy: Gtk.PolicyType.NEVER, vexpand: true, child: box });
}

export function createTasksView(toast: (message: string) => void): TasksView {
  let model: TasksModel | null = null;
  let hidden: ReadonlySet<string> = new Set();

  const banner = new Adw.Banner({ revealed: false });
  const sections = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 18 });
  for (const side of ['start', 'end', 'top', 'bottom'] as const) sections[`set_margin_${side}`](12);
  const clamp = new Adw.Clamp({ maximumSize: 720, child: sections });
  const scroller = new Gtk.ScrolledWindow({
    hscrollbarPolicy: Gtk.PolicyType.NEVER,
    vexpand: true,
    child: clamp,
  });
  const status = new Adw.StatusPage({
    title: _('Tasks'),
    description: _('Your reminders will appear here.'),
    iconName: 'object-select-symbolic',
    vexpand: true,
  });
  const stack = new Gtk.Stack();
  stack.add_named(status, 'status');
  stack.add_named(scroller, 'list');

  const main = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
  main.append(banner);
  main.append(stack);

  const pane = new AdaptivePane();
  pane.setMain(main);

  const clear = (): void => {
    let child = sections.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      sections.remove(child);
      child = next;
    }
  };

  const report = (outcome: WriteOutcome): void => {
    if (outcome.kind === 'conflict') toast(_('This task was changed elsewhere. Reloading it.'));
    else if (outcome.kind === 'denied') toast(_('Changing this list is not allowed.'));
    else if (outcome.kind === 'failed')
      toast(fmt(_('Could not save: {message}'), { message: outcome.message }));
    if (outcome.kind !== 'ok') render();
  };

  const showDetail = (item: ReminderItem): void => {
    const list = model?.calendar(item.calendarUid);
    pane.present(buildDetail(item, list?.name ?? item.calendarUid), item.summary ?? _('Untitled'));
  };

  const buildRow = (item: ReminderItem, now: Date): TaskRow => {
    const calendar = model?.calendar(item.calendarUid) ?? null;
    const row = new TaskRow();
    row.setTask(toRowData(item, { name: calendar?.name ?? '', colour: colourFor(item.calendarUid) }), now);
    row.writable = model?.writable(item.calendarUid) ?? false;
    onSignal(row, 'toggled', (_self: unknown, done: boolean) => {
      void model?.setDone(item, done).then(report);
    });
    onSignal(row, 'postpone', () => {
      void model?.postpone(item).then(report);
    });
    onSignal(row, 'activated', () => showDetail(item));
    return row;
  };

  const buildEventRow = (o: AgendaOccurrence): Adw.ActionRow => {
    const calendar = model?.calendar(o.calendarUid);
    const row = new Adw.ActionRow({
      title: escapeMarkup(o.summary ?? _('(no title)')),
      subtitle: escapeMarkup([occurrenceTime(o), calendar?.name].filter(Boolean).join(' · ')),
      activatable: false,
    });
    row.add_prefix(new Gtk.Image({ iconName: 'x-office-calendar-symbolic' }));
    return row;
  };

  const buildSection = (
    title: string,
    items: readonly ReminderItem[],
    now: Date,
    events: readonly AgendaOccurrence[] = [],
  ): Gtk.Widget => {
    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 });
    const heading = new Gtk.Label({ label: title, xalign: 0 });
    heading.add_css_class('heading');
    heading.set_margin_start(12);
    const list = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE });
    list.add_css_class('boxed-list');
    for (const o of events) list.append(buildEventRow(o));
    for (const item of items) list.append(buildRow(item, now));
    box.append(heading);
    box.append(list);
    return box;
  };

  function render(): void {
    if (model === null) return;
    const now = new Date();
    const problems = describeSyncProblems(model.syncStatus());
    banner.set_title(problems ?? '');
    banner.set_revealed(problems !== null);

    clear();
    const agenda = buildVisibleAgenda(model.reminders(), hidden, now, model.occurrences());
    for (const section of agenda.sections) {
      sections.append(
        buildSection(
          sectionTitle(section.id),
          section.items,
          now,
          section.id === 'today' ? agenda.events : [],
        ),
      );
    }
    if (agenda.completed.length > 0) {
      const expander = new Gtk.Expander({
        label: fmt(_('Completed ({count})'), { count: agenda.completed.length }),
        expanded: false,
      });
      expander.set_child(buildSection('', agenda.completed, now));
      sections.append(expander);
    }
    const any = agenda.sections.length > 0 || agenda.completed.length > 0;
    if (!any) {
      status.set_title(_('Tasks'));
      status.set_description(
        model.reminders().length > 0 ? _('Every list is hidden.') : _('Your reminders will appear here.'),
      );
    }
    stack.set_visible_child_name(any ? 'list' : 'status');
  }

  return {
    widget: pane,
    setSizeClass: (sizeClass) => pane.setSizeClass(sizeClass),
    setModel(next, nextHidden) {
      model = next;
      hidden = nextHidden;
      next.subscribe(render);
      render();
    },
    setHidden(next) {
      hidden = next;
      render();
    },
    setError(message) {
      status.set_title(_('Cannot load tasks'));
      status.set_description(message);
      status.set_icon_name('dialog-warning-symbolic');
      stack.set_visible_child_name('status');
    },
    syncProblems: () => (model ? describeSyncProblems(model.syncStatus()) : null),
  };
}
