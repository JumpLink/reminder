/**
 * The calendar view: one month, one week or one day of events, read-only.
 *
 * Content is built once and the container around it changes with the size class (ADR 0012). The
 * month grid is the same widget everywhere — on a phone it draws dots and pairs with the day's
 * agenda beneath it, on a wide window it draws bars. The week has no room for seven time columns
 * below `wide`, so it shows three days there; the whole week stays one tap away in the month.
 *
 * Nothing here converts a time zone that did not resolve (ADR 0009): a flagged instance keeps the
 * clock it was written with and says so, in the title's marker and in the detail pane's own line.
 */

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import { AdaptivePane, AgendaList, MonthGrid, TimeGrid, type CalendarEvent } from '@gjsify/adwaita-extended';
import { isoDate, parseIsoDate } from '@gjsify/adwaita-extended/calendar-format';
import type { LocalDate } from '@gjsify/calendar-layout';

import { _, errorMessage, fmt } from '@reminder/core';

import type { SizeClass } from '../constants.ts';
import type { CalendarModel } from '../calendar-model.ts';
import {
  CALENDAR_MODES,
  calendarTitle,
  calendarWindow,
  describeCalendarFailures,
  firstWeekdayFor,
  focusHour,
  occurrenceId,
  occurrenceSpan,
  shiftAnchor,
  toCalendarEvents,
  weekColumns,
  windowRange,
  zoneNote,
  type CalendarMode,
  type CalendarOccurrence,
} from '../calendar-view-model.ts';
import type { GuiSettings } from '../settings.ts';
import { onSignal } from '../signals.ts';
import { colourFor } from '../view-model.ts';

export interface CalendarView {
  widget: Gtk.Widget;
  setSizeClass(sizeClass: SizeClass): void;
  setModel(model: CalendarModel, settings: GuiSettings, hidden: ReadonlySet<string>): void;
  setHidden(hidden: ReadonlySet<string>): void;
  /** Replaces the grid with a message, e.g. a configuration error. */
  setError(message: string): void;
  setMode(mode: CalendarMode): void;
  /** Previous (-1) or next (+1) month, week or day. */
  step(delta: number): void;
  goToday(): void;
  /** Re-reads the visible window; what the refresh action does here. */
  reload(): void;
  /** Set by the window so the `win.calendar-mode` action follows the toggles. */
  onModeChanged: ((mode: CalendarMode) => void) | null;
}

/** `Pango.EllipsizeMode.END`, spelled as a number so the app needs no `@girs/pango` dependency. */
const ELLIPSIZE_END = 3;

/** Today as the wall calendar has it, which is the machine's local date and not a UTC one. */
function today(): LocalDate {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

const MODE_LABEL: Record<CalendarMode, () => string> = {
  month: () => _('Month'),
  week: () => _('Week'),
  day: () => _('Day'),
};

function detailRow(title: string, value: string): Adw.ActionRow {
  const row = new Adw.ActionRow({ title, subtitle: value, useMarkup: false, subtitleSelectable: true });
  row.add_css_class('property');
  return row;
}

function openUri(uri: string, parent: Gtk.Widget, onFailure: (message: string) => void): void {
  const root = parent.get_root();
  new Gtk.UriLauncher({ uri }).launch(root instanceof Gtk.Window ? root : null, null, (launcher, res) => {
    try {
      launcher?.launch_finish(res);
    } catch (err) {
      onFailure(fmt(_('Could not open the event: {message}'), { message: errorMessage(err) }));
    }
  });
}

function buildDetail(
  occurrence: CalendarOccurrence,
  calendarName: string,
  toast: (message: string) => void,
): Gtk.Widget {
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
  for (const side of ['start', 'end', 'top', 'bottom'] as const) box[`set_margin_${side}`](18);
  const title = new Gtk.Label({
    label: occurrence.summary ?? _('(no title)'),
    wrap: true,
    xalign: 0,
    selectable: true,
  });
  title.add_css_class('title-2');
  box.append(title);

  const rows = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE });
  rows.add_css_class('boxed-list');
  const span = occurrenceSpan(occurrence);
  if (span) rows.append(detailRow(_('When'), span));
  if (occurrence.location) rows.append(detailRow(_('Where'), occurrence.location));
  rows.append(detailRow(_('Calendar'), calendarName));
  const note = zoneNote(occurrence);
  if (note) rows.append(detailRow(_('Time zone'), note));
  box.append(rows);

  if (occurrence.url) {
    const url = occurrence.url;
    const button = new Gtk.Button({ label: _('Open the original'), halign: Gtk.Align.START });
    button.add_css_class('pill');
    button.connect('clicked', () => openUri(url, button, toast));
    box.append(button);
  }
  return new Gtk.ScrolledWindow({ hscrollbarPolicy: Gtk.PolicyType.NEVER, vexpand: true, child: box });
}

function navButton(icon: string, label: string): Gtk.Button {
  const button = new Gtk.Button({ iconName: icon, tooltipText: label });
  button.update_property([Gtk.AccessibleProperty.LABEL], [label]);
  return button;
}

export function createCalendarView(toast: (message: string) => void): CalendarView {
  let model: CalendarModel | null = null;
  let settings: GuiSettings | null = null;
  let hidden: ReadonlySet<string> = new Set();
  let sizeClass: SizeClass = 'medium';
  let mode: CalendarMode = 'month';
  let anchor: LocalDate = today();
  let selected: string = isoDate(anchor);
  let byId = new Map<string, CalendarOccurrence>();
  /** Only the newest load may paint: a fast click through months must not be overtaken. */
  let generation = 0;

  const month = new MonthGrid();
  const grid = new TimeGrid();
  const dayAgenda = new AgendaList();
  const banner = new Adw.Banner({ revealed: false });

  // Compact pairs the month with the selected day's list; the other rungs show the month alone.
  const monthBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 });
  const agendaFrame = new Gtk.ScrolledWindow({
    hscrollbarPolicy: Gtk.PolicyType.NEVER,
    vexpand: true,
    child: dayAgenda,
  });
  monthBox.append(month);

  const title = new Gtk.Label({ ellipsize: ELLIPSIZE_END, singleLineMode: true, hexpand: true });
  title.add_css_class('heading');
  // A span like "30 Nov – 2 Dec 2026" is wide enough to reach the navigation at phone width, and
  // a centred label has no padding of its own.
  for (const side of ['start', 'end'] as const) title[`set_margin_${side}`](12);

  const modes = new Adw.ToggleGroup({ canShrink: true, valign: Gtk.Align.CENTER });
  for (const name of CALENDAR_MODES) modes.add(new Adw.Toggle({ name, label: MODE_LABEL[name]() }));
  modes.set_active_name(mode);

  const nav = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0, valign: Gtk.Align.CENTER });
  nav.add_css_class('linked');
  const previous = navButton('go-previous-symbolic', _('Previous'));
  const next = navButton('go-next-symbolic', _('Next'));
  const todayButton = new Gtk.Button({ label: _('Today') });
  nav.append(previous);
  nav.append(todayButton);
  nav.append(next);

  const bar = new Gtk.CenterBox({ hexpand: true });
  bar.set_start_widget(nav);
  bar.set_center_widget(title);
  for (const side of ['start', 'end', 'top', 'bottom'] as const) bar[`set_margin_${side}`](6);
  // Second row, compact only: at phone width the toggles and the title do not share one line.
  const modeRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, visible: false });
  for (const side of ['start', 'end'] as const) modeRow[`set_margin_${side}`](6);
  modeRow.set_margin_bottom(6);

  const status = new Adw.StatusPage({
    title: _('Calendar'),
    description: _('Events from your calendars will appear here.'),
    iconName: 'x-office-calendar-symbolic',
    vexpand: true,
  });
  const pages = new Gtk.Stack({ vexpand: true });
  pages.add_named(monthBox, 'month');
  pages.add_named(grid, 'grid');
  pages.add_named(status, 'status');

  const main = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
  main.append(bar);
  main.append(modeRow);
  main.append(banner);
  main.append(pages);

  const pane = new AdaptivePane();
  pane.setMain(main);

  const columns = (): number => weekColumns(sizeClass);

  const showDetail = (id: string): void => {
    const occurrence = byId.get(id);
    if (!occurrence) return;
    const calendar = model?.calendar(occurrence.calendarUid);
    pane.present(
      buildDetail(occurrence, calendar?.name ?? occurrence.calendarUid, toast),
      occurrence.summary ?? _('(no title)'),
    );
  };

  const paintAgenda = (events: readonly CalendarEvent[]): void => {
    dayAgenda.setItems(events);
    dayAgenda.setWindow(selected, 1);
  };

  /**
   * Everything that depends on the mode, the size class or the anchor, without re-reading.
   *
   * `scroll` is false for a repaint that did not move the window — hiding a source must not throw
   * away where the reader had scrolled to.
   */
  const layout = (events: readonly CalendarEvent[], scroll = false): void => {
    const first = firstWeekdayFor(settings?.weekStart() ?? 'system');
    const window = calendarWindow(mode, anchor, first, columns());
    const now = new Date();
    title.set_label(calendarTitle(mode, anchor, window));
    if (mode === 'month') {
      month.setFirstWeekday(first);
      month.setMonth(anchor.year, anchor.month);
      month.setToday(now);
      month.setSelected(sizeClass === 'compact' ? selected : null);
      month.setItems(events);
      paintAgenda(events);
      pages.set_visible_child_name('month');
    } else {
      grid.setRange(isoDate(window.first), window.days);
      grid.setNow(now);
      grid.setItems(events);
      pages.set_visible_child_name('grid');
      // After the stack shows it, so the scroller has a page size to clamp against.
      if (scroll) grid.scrollToHour(focusHour(events, window, now));
    }
  };

  const reload = (scroll = true): void => {
    if (model === null) return;
    const first = firstWeekdayFor(settings?.weekStart() ?? 'system');
    const window = calendarWindow(mode, anchor, first, columns());
    const token = ++generation;
    void model
      .load(windowRange(window))
      .then((load) => {
        if (token !== generation) return;
        byId = new Map(load.occurrences.map((o) => [occurrenceId(o), o]));
        const problems = describeCalendarFailures(load.failures);
        banner.set_title(problems ?? '');
        banner.set_revealed(problems !== null);
        layout(toCalendarEvents(load.occurrences, hidden, colourFor), scroll);
      })
      .catch((err: unknown) => {
        if (token !== generation) return;
        banner.set_title(errorMessage(err));
        banner.set_revealed(true);
      });
  };

  onSignal(month, 'day-activated', (_self: unknown, date: string) => {
    const parsed = parseIsoDate(date);
    if (parsed === null) return;
    selected = date;
    if (sizeClass === 'compact') {
      anchor = parsed;
      layoutFromCache();
      return;
    }
    // Wide and medium have the room: activating a day is a request to look at it.
    anchor = parsed;
    setMode('day');
  });
  onSignal(month, 'item-activated', (_self: unknown, id: string) => showDetail(id));
  onSignal(grid, 'item-activated', (_self: unknown, id: string) => showDetail(id));
  onSignal(dayAgenda, 'item-activated', (_self: unknown, id: string) => showDetail(id));
  onSignal(grid, 'slot-activated', (_self: unknown, date: string) => {
    const parsed = parseIsoDate(date);
    if (parsed !== null) selected = isoDate(parsed);
  });

  /** A repaint from what was already loaded — the month window does not change with the day. */
  function layoutFromCache(): void {
    layout(toCalendarEvents([...byId.values()], hidden, colourFor));
  }

  function setMode(next: CalendarMode): void {
    if (mode === next && modes.get_active_name() === next) return;
    mode = next;
    if (modes.get_active_name() !== next) modes.set_active_name(next);
    applyRung();
    view.onModeChanged?.(next);
    reload();
  }

  modes.connect('notify::active-name', () => {
    const name = modes.get_active_name();
    if (name !== null && name !== mode && (CALENDAR_MODES as readonly string[]).includes(name)) {
      setMode(name as CalendarMode);
    }
  });
  previous.connect('clicked', () => step(-1));
  next.connect('clicked', () => step(1));
  todayButton.connect('clicked', () => goToday());

  function step(delta: number): void {
    anchor = shiftAnchor(mode, anchor, delta, columns());
    if (mode !== 'month') selected = isoDate(anchor);
    reload();
  }

  function goToday(): void {
    anchor = today();
    selected = isoDate(anchor);
    reload();
  }

  /** The one place that knows what each rung looks like; a rung sets everything it needs. */
  function applyRung(): void {
    const compact = sizeClass === 'compact';
    const pairs = compact && mode === 'month';
    if (compact) {
      if (modes.get_parent() !== modeRow) {
        bar.set_end_widget(null);
        modes.set_hexpand(true);
        modes.set_homogeneous(true);
        modeRow.append(modes);
      }
      modeRow.set_visible(true);
    } else {
      if (modes.get_parent() !== bar) {
        if (modes.get_parent() === modeRow) modeRow.remove(modes);
        modes.set_hexpand(false);
        modes.set_homogeneous(false);
        bar.set_end_widget(modes);
      }
      modeRow.set_visible(false);
    }
    month.set_vexpand(!pairs);
    if (pairs && agendaFrame.get_parent() === null) monthBox.append(agendaFrame);
    if (!pairs && agendaFrame.get_parent() === monthBox) monthBox.remove(agendaFrame);
    month.setSizeClass(sizeClass);
    pane.setSizeClass(sizeClass);
  }

  dayAgenda.setEmptyText(_('Nothing on this day.'));
  applyRung();

  const view: CalendarView = {
    widget: pane,
    onModeChanged: null,
    setSizeClass(next) {
      if (next === sizeClass) return;
      const widthChanged = weekColumns(next) !== weekColumns(sizeClass);
      sizeClass = next;
      applyRung();
      // A week that grew from three days to seven needs the days it never loaded.
      if (widthChanged && mode === 'week') reload();
      else layoutFromCache();
    },
    setModel(nextModel, nextSettings, nextHidden) {
      model = nextModel;
      settings = nextSettings;
      hidden = nextHidden;
      reload();
    },
    setHidden(next) {
      hidden = next;
      layoutFromCache();
    },
    setError(message) {
      generation++;
      status.set_title(_('Cannot load the calendar'));
      status.set_description(message);
      status.set_icon_name('dialog-warning-symbolic');
      pages.set_visible_child_name('status');
    },
    setMode,
    step,
    goToday,
    // A refresh re-reads the same window: it must not yank the grid back to the focus hour.
    reload: () => reload(false),
  };
  return view;
}
