/**
 * The board view: the cards of every board source in the four lanes (plus the unsorted one), laid
 * out by size class by `KanbanBoard`. A card opens its detail in an `AdaptivePane` (inspector,
 * dialog or bottom sheet), where "Move to …" names the lanes and "Open in original" hands the
 * card's own page to the browser (ADR 0007 §6).
 *
 * What is shown is decided in `board-view-model.ts` and every write goes through
 * `board-write.ts`; this file only paints the two and reports what they answered. The pointer
 * drag belongs to the widget, which asks rather than moves (ADR 0012 §3) — "Move to …" is the
 * same request from a list, and the only one a touch screen or a compact window has.
 *
 * The filters are local to the view and change no request: every board is read with one wide query
 * (`BOARD_QUERY`), so flipping a chip costs no round trip.
 */

import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import { AdaptivePane, FilterChip, KanbanBoard, type BoardColumnData } from '@gjsify/adwaita-extended';

import { _, errorMessage, fmt, MINE_FILTERS, type MineFilter } from '@reminder/core';

import type { BoardModel } from '../board-model.ts';
import {
  activeBoardChips,
  anyWritable,
  boardCardDetail,
  boardSourceOptions,
  boardStatus,
  buildBoardColumns,
  describeBoardProblems,
  DEFAULT_BOARD_FILTERS,
  DONE_WINDOW_DAYS,
  findBoardCard,
  laneTitle,
  mineLabel,
  showsSource,
  withoutBoardChip,
  type BoardCardDetail,
  type BoardFilters,
  type BoardViewLane,
} from '../board-view-model.ts';
import { columnPosition, createBoardWriter, MOVE_TARGET_LANES, type BoardWriter } from '../board-write.ts';
import { CARD_HOOK, type SizeClass } from '../constants.ts';
import { onSignal } from '../signals.ts';

/** A toast's one button — the conflict message offers a refresh (ADR 0013 §7). */
export interface ToastAction {
  label: string;
  run(): void;
}

export type BoardToast = (message: string, action?: ToastAction) => void;

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

/** What the detail offers as a move. Null for a card whose lane cannot be a write target at all. */
interface MoveOffer {
  /** Why the lanes are insensitive, as a sentence; null when the move is offered. */
  blocked: string | null;
  /** Where the card is now — the one lane the list does not offer. */
  lane: BoardViewLane;
  run(lane: BoardViewLane): void;
}

/**
 * "Move to …": the lanes as a list, always there, whatever the size class. The pointer drag is the
 * shortcut for a mouse; this is the path a touch screen and a compact window have, so it is never
 * hidden behind a hover or a width (plan §6.8). A board that cannot take the write keeps the rows
 * visible and insensitive, with the reason underneath — a card that vanishes explains nothing.
 */
function buildMove(move: MoveOffer): Gtk.Widget {
  const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 6 });
  const heading = new Gtk.Label({ label: _('Move to'), xalign: 0 });
  heading.add_css_class('heading');
  box.append(heading);

  const lanes = new Gtk.ListBox({ selectionMode: Gtk.SelectionMode.NONE });
  lanes.add_css_class('boxed-list');
  for (const lane of MOVE_TARGET_LANES) {
    if (lane === move.lane) continue;
    const row = new Adw.ActionRow({ title: laneTitle(lane), activatable: true });
    row.add_suffix(new Gtk.Image({ iconName: 'go-next-symbolic' }));
    row.connect('activated', () => move.run(lane));
    lanes.append(row);
  }
  lanes.set_sensitive(move.blocked === null);
  box.append(lanes);

  if (move.blocked !== null) {
    const why = new Gtk.Label({ label: move.blocked, wrap: true, xalign: 0 });
    why.add_css_class('dim-label');
    why.add_css_class('caption');
    box.append(why);
  }
  return box;
}

function buildDetail(detail: BoardCardDetail, toast: BoardToast, move: MoveOffer | null): Gtk.Widget {
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

  if (move !== null) box.append(buildMove(move));

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
  const scroller = new Gtk.ScrolledWindow({
    hscrollbarPolicy: Gtk.PolicyType.NEVER,
    vexpand: true,
    child: box,
  });
  // On a phone-sized sheet "Move to" sits below the fold, where no screenshot can see it.
  if (move !== null && process.env[CARD_HOOK] === 'move') scrollToEnd(scroller);
  return scroller;
}

/** `REMINDER_APP_CARD=move`: once the detail has been laid out, show its end. Screenshots only. */
function scrollToEnd(scroller: Gtk.ScrolledWindow): void {
  const adjustment = scroller.get_vadjustment();
  const handler = { id: 0 };
  handler.id = adjustment.connect('changed', () => {
    // Before the first allocation there is nothing to scroll, and `changed` comes again.
    if (adjustment.upper <= adjustment.pageSize) return;
    adjustment.value = adjustment.upper - adjustment.pageSize;
    adjustment.disconnect(handler.id);
  });
}

export function createBoardView(toast: BoardToast): BoardView {
  let model: BoardModel | null = null;
  let writer: BoardWriter | null = null;
  let filters: BoardFilters = { ...DEFAULT_BOARD_FILTERS };
  /** The lanes as they were last drawn, so a drop index inside one can be read back. */
  let drawn: readonly BoardColumnData[] = [];
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

  /**
   * One move, from the drag or from the list, and what the person hears about it. The card is
   * already in the new lane by the time this returns — `move` put it there before it called the
   * source, and took it back if the source refused.
   */
  const requestMove = async (key: string, lane: BoardViewLane, position?: number): Promise<void> => {
    const outcome = await writer?.move(key, lane, position);
    if (outcome === undefined || outcome.kind !== 'refused') return;
    toast(
      outcome.message,
      outcome.conflict ? { label: _('Refresh'), run: () => model?.refresh() } : undefined,
    );
  };

  /** The detail of the card that is open, refreshed from the current snapshot. */
  const showDetail = (key: string): void => {
    const snapshot = model?.snapshot();
    const found = snapshot ? findBoardCard(snapshot, key) : null;
    if (!found) return;
    open = key;
    const detail = boardCardDetail(found.card, found.board);
    const board = found.board;
    const offer: MoveOffer | null =
      writer === null
        ? null
        : {
            blocked: writer.blocked(board),
            // The dropped lane while the write is in flight, so the list agrees with the board.
            lane: writer.pending().get(key) ?? detail.lane,
            run: (lane) => void requestMove(key, lane),
          };
    pane.present(buildDetail(detail, toast, offer), detail.title);
  };

  onSignal(board, 'card-activated', (id: string) => showDetail(id));
  onSignal(board, 'card-move-requested', (id: string, columnId: string, position: number) => {
    const lane = columnId as BoardViewLane;
    const keys = (drawn.find((column) => column.id === columnId)?.cards ?? []).map((card) => card.id);
    void requestMove(id, lane, columnPosition(keys, id, position));
  });

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
      const toggle = new Adw.SwitchRow({
        title: option.name,
        useMarkup: false,
        active: showsSource(filters, option.id),
      });
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
    const columns = buildBoardColumns(snapshot, filters, now, writer?.pending());
    drawn = columns;
    const state = boardStatus(snapshot, columns);

    // A source that failed while others answered is a line over the cards, not a state.
    const line = state.kind === 'failed' ? null : describeBoardProblems(snapshot.problems);
    banner.set_title(line ?? '');
    banner.set_revealed(line !== null);

    // A board the adapter cannot write to at all gets no drag at all; the grant is asked at the drop.
    board.writable = anyWritable(snapshot.boards);
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
      writer = createBoardWriter({
        snapshot: () => next.snapshot(),
        write: () => next.write(),
        refresh: (card) => next.refresh(card),
        changed: render,
      });
      next.subscribe(() => {
        // A new snapshot may be the one that carries the card into the lane it was dropped in.
        writer?.reconcile();
        render();
      });
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
      if (snapshot && openFirstOf(buildBoardColumns(snapshot, filters, new Date(), writer?.pending())))
        return true;
      // The first sync has not landed yet: remember the wish and open the card when it does.
      wantsFirstCard = true;
      return false;
    },
  };
}
