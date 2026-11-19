/**
 * The board view: the cards of every board source in the four lanes (plus the unsorted one), laid
 * out by size class by `KanbanBoard`. Read-only in Phase 2 — a card opens its detail in an
 * `AdaptivePane` (inspector, dialog or bottom sheet), and "Open in original" hands the card's own
 * page to the browser, which is the only write path a reader has for now (ADR 0007 §3, §6).
 *
 * What is shown is decided in `board-view-model.ts`; this file only paints it. The filters are
 * local to the view and change no request: every board is read with one wide query
 * (`BOARD_QUERY`), so flipping a chip costs no round trip.
 */

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import { AdaptivePane, FilterChip, KanbanBoard, type BoardColumnData } from '@gjsify/adwaita-extended';

import { _, errorMessage, fmt, MINE_FILTERS, type MineFilter } from '@reminder/core';

import type { BoardModel } from '../board-model.ts';
import {
  activeBoardChips,
  boardCardDetail,
  boardSourceOptions,
  boardStatus,
  buildBoardColumns,
  describeBoardProblems,
  DEFAULT_BOARD_FILTERS,
  DONE_WINDOW_DAYS,
  findBoardCard,
  mineLabel,
  showsSource,
  withoutBoardChip,
  type BoardCardDetail,
  type BoardFilters,
} from '../board-view-model.ts';
import type { SizeClass } from '../constants.ts';
import { onSignal } from '../signals.ts';

export interface BoardView {
  widget: Gtk.Widget;
  setSizeClass(sizeClass: SizeClass): void;
  setModel(model: BoardModel): void;
  /** Replaces the board with a message, e.g. a configuration error. */
  setError(message: string): void;
  /**
   * Opens the detail of the first card — the dev hook for a screenshot. Returns whether a card
   * was there already; if not, the next sync that brings one opens it.
   */
  openFirstCard(): boolean;
}

function clear(box: Gtk.Box): void {
  let child = box.get_first_child();
  while (child) {
    const next = child.get_next_sibling();
    box.remove(child);
    child = next;
  }
}

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
      onFailure(fmt(_('Could not open the card: {message}'), { message: errorMessage(err) }));
    }
  });
}

function buildDetail(detail: BoardCardDetail, toast: (message: string) => void): Gtk.Widget {
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
  for (const side of ['start', 'end', 'top', 'bottom'] as const) box[`set_margin_${side}`](18);
  const title = new Gtk.Label({ label: detail.title, wrap: true, xalign: 0, selectable: true });
  title.add_css_class('title-2');
  box.append(title);

  const rows = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE });
  rows.add_css_class('boxed-list');
  rows.append(detailRow(_('Board'), detail.sourceLabel));
  // Both, when they differ: the lane is ours, the column is what the source calls it (ADR 0008).
  rows.append(detailRow(_('Lane'), detail.laneTitle));
  if (detail.sourceColumn !== '' && detail.sourceColumn !== detail.laneTitle)
    rows.append(detailRow(_('Column'), detail.sourceColumn));
  if (detail.due)
    rows.append(detailRow(_('Due'), detail.due.toLocaleDateString(undefined, { dateStyle: 'medium' })));
  if (detail.assignees.length > 0) rows.append(detailRow(_('Assigned to'), detail.assignees.join(', ')));
  if (detail.labels.length > 0) rows.append(detailRow(_('Labels'), detail.labels.join(', ')));
  box.append(rows);

  const url = detail.url;
  if (url !== null) {
    const open = new Gtk.Button({
      label: _('Open in original'),
      halign: Gtk.Align.CENTER,
      cssClasses: ['pill', 'suggested-action'],
    });
    open.connect('clicked', () => openUri(url, open, toast));
    box.append(open);
  } else {
    // No page to send anybody to: say so rather than offering a button that cannot work.
    const note = new Gtk.Label({ label: _('This source has no page of its own.'), wrap: true, xalign: 0 });
    note.add_css_class('dim-label');
    note.add_css_class('caption');
    box.append(note);
  }
  return new Gtk.ScrolledWindow({ hscrollbarPolicy: Gtk.PolicyType.NEVER, vexpand: true, child: box });
}

export function createBoardView(toast: (message: string) => void): BoardView {
  let model: BoardModel | null = null;
  let filters: BoardFilters = { ...DEFAULT_BOARD_FILTERS };
  /** The card whose detail is open, so a re-render keeps it current instead of closing it. */
  let open: string | null = null;
  let building = false;
  /** `openFirstCard()` was asked before a card had arrived; the next render honours it. */
  let wantsFirstCard = false;

  const banner = new Adw.Banner({ revealed: false });
  const board = new KanbanBoard();

  const chips = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 });
  const chipScroll = new Gtk.ScrolledWindow({
    hscrollbarPolicy: Gtk.PolicyType.EXTERNAL,
    vscrollbarPolicy: Gtk.PolicyType.NEVER,
    hexpand: true,
    child: chips,
  });
  const mine = new Adw.ComboRow({
    title: _('Cards'),
    model: Gtk.StringList.new(MINE_FILTERS.map(mineLabel)),
  });
  const done = new Adw.SwitchRow({
    title: _('Show done'),
    subtitle: fmt(_('The last {days} days'), { days: DONE_WINDOW_DAYS }),
  });
  const sourceRows = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE });
  sourceRows.add_css_class('boxed-list');
  const generalRows = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE });
  generalRows.add_css_class('boxed-list');
  generalRows.append(mine);
  generalRows.append(done);
  const popoverBox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 12 });
  for (const side of ['start', 'end', 'top', 'bottom'] as const) popoverBox[`set_margin_${side}`](6);
  popoverBox.append(generalRows);
  popoverBox.append(sourceRows);
  const popover = new Gtk.Popover({ child: popoverBox, widthRequest: 260 });
  const filterButton = new Gtk.MenuButton({
    label: _('Filter'),
    popover,
    alwaysShowArrow: true,
    cssClasses: ['flat'],
    valign: Gtk.Align.CENTER,
  });
  const bar = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 });
  bar.set_margin_start(12);
  bar.set_margin_end(12);
  bar.set_margin_top(6);
  bar.append(chipScroll);
  bar.append(filterButton);

  const status = new Adw.StatusPage({
    title: _('Board'),
    description: _('Your cards will appear here.'),
    iconName: 'view-grid-symbolic',
    vexpand: true,
  });
  const spinner = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 12,
    halign: Gtk.Align.CENTER,
    valign: Gtk.Align.CENTER,
    vexpand: true,
  });
  spinner.append(new Adw.Spinner({ widthRequest: 32, heightRequest: 32 }));
  spinner.append(new Gtk.Label({ label: _('Loading boards…') }));

  const stack = new Gtk.Stack();
  stack.add_named(status, 'status');
  stack.add_named(spinner, 'loading');
  stack.add_named(board, 'content');

  const main = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
  main.append(banner);
  main.append(bar);
  main.append(stack);

  const pane = new AdaptivePane();
  pane.setMain(main);

  const setFilters = (next: BoardFilters): void => {
    filters = next;
    render();
  };

  /** The detail of the card that is open, refreshed from the current snapshot. */
  const showDetail = (key: string): void => {
    const snapshot = model?.snapshot();
    const found = snapshot ? findBoardCard(snapshot, key) : null;
    if (!found) return;
    open = key;
    const detail = boardCardDetail(found.card, found.board);
    pane.present(buildDetail(detail, toast), detail.title);
  };

  onSignal(board, 'card-activated', (id: string) => showDetail(id));

  const openFirstOf = (columns: readonly BoardColumnData[]): boolean => {
    const first = columns.flatMap((column) => column.cards)[0];
    if (!first) return false;
    showDetail(first.id);
    return true;
  };

  const buildChips = (): void => {
    const snapshot = model?.snapshot();
    clear(chips);
    const active = snapshot ? activeBoardChips(snapshot, filters) : [];
    for (const chip of active) {
      const widget = new FilterChip(chip.label);
      onSignal(widget, 'removed', () => setFilters(withoutBoardChip(filters, chip.key)));
      chips.append(widget);
    }
    chipScroll.set_visible(active.length > 0);
  };

  /**
   * The popover, rebuilt from the sources that actually answered. `building` keeps the setters
   * below from reading as the person's own change and re-rendering in a loop.
   */
  const buildPopover = (): void => {
    const snapshot = model?.snapshot();
    building = true;
    mine.set_selected(MINE_FILTERS.indexOf(filters.mine));
    done.set_active(filters.includeDone);
    let row = sourceRows.get_first_child();
    while (row) {
      const next = row.get_next_sibling();
      sourceRows.remove(row);
      row = next;
    }
    const options = snapshot ? boardSourceOptions(snapshot) : [];
    for (const option of options) {
      const toggle = new Adw.SwitchRow({ title: option.name, active: showsSource(filters, option.id) });
      toggle.connect('notify::active', () => {
        if (building) return;
        // All on is "no selection at all", so a source the config gains later is shown too.
        const on = options.filter((o) => (o.id === option.id ? toggle.active : showsSource(filters, o.id)));
        setFilters({ ...filters, sources: on.length === options.length ? [] : on.map((o) => o.id) });
      });
      sourceRows.append(toggle);
    }
    sourceRows.set_visible(options.length > 1);
    building = false;
  };

  mine.connect('notify::selected', () => {
    if (building) return;
    const next: MineFilter = MINE_FILTERS[mine.selected] ?? 'all';
    if (next !== filters.mine) setFilters({ ...filters, mine: next });
  });
  done.connect('notify::active', () => {
    if (building) return;
    if (done.active !== filters.includeDone) setFilters({ ...filters, includeDone: done.active });
  });

  function render(): void {
    if (model === null) return;
    const snapshot = model.snapshot();
    const now = new Date();
    const columns = buildBoardColumns(snapshot, filters, now);
    const state = boardStatus(snapshot, columns);

    // A source that failed while others answered is a line over the cards, not a state.
    const line = state.kind === 'failed' ? null : describeBoardProblems(snapshot.problems);
    banner.set_title(line ?? '');
    banner.set_revealed(line !== null);

    board.setColumns(columns, now);
    switch (state.kind) {
      case 'cards':
        stack.set_visible_child_name('content');
        break;
      case 'loading':
        stack.set_visible_child_name('loading');
        break;
      default:
        status.set_icon_name(state.kind === 'failed' ? 'dialog-warning-symbolic' : 'view-grid-symbolic');
        status.set_title(state.kind === 'failed' ? _('Cannot load the board') : _('Board'));
        status.set_description(
          state.kind === 'failed'
            ? state.message
            : state.kind === 'unconfigured'
              ? _('Connect an account with task lists or boards to see cards here.')
              : _('No card matches the filters.'),
        );
        stack.set_visible_child_name('status');
        break;
    }

    buildChips();
    buildPopover();
    // The card that is open may have changed in this very sync.
    if (open !== null && findBoardCard(snapshot, open) === null) {
      open = null;
      pane.close();
    } else if (open !== null) showDetail(open);
    if (open === null && wantsFirstCard && openFirstOf(columns)) wantsFirstCard = false;
  }

  return {
    widget: pane,
    setSizeClass(sizeClass) {
      pane.setSizeClass(sizeClass);
      board.setSizeClass(sizeClass);
    },
    setModel(next) {
      model = next;
      next.subscribe(render);
      render();
    },
    setError(message) {
      status.set_title(_('Cannot load the board'));
      status.set_description(message);
      status.set_icon_name('dialog-warning-symbolic');
      stack.set_visible_child_name('status');
    },
    openFirstCard() {
      const snapshot = model?.snapshot();
      if (snapshot && openFirstOf(buildBoardColumns(snapshot, filters, new Date()))) return true;
      // The first sync has not landed yet: remember the wish and open the card when it does.
      wantsFirstCard = true;
      return false;
    },
  };
}
