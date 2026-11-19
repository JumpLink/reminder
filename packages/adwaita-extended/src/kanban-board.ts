import Adw from '@girs/adw-1';
import Gdk from '@girs/gdk-4.0';
import GLib from '@girs/glib-2.0';
import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';

import type { BoardCard } from './board-card.ts';
import { BoardColumn, cardCountText, type BoardColumnData } from './board-column.ts';
import {
  boardPresentation,
  clampColumn,
  columnOffset,
  columnWidth,
  COLUMN_GAP,
  neighbourFocus,
  snapColumn,
  type BoardPresentation,
} from './board-rules.ts';
import { emitSignal, onSignal } from './signals.ts';
import type { SizeClass } from './size-class.ts';
import { ensureStyles } from './styles.ts';

/**
 * A kanban board, laid out by size class (rules in `board-rules.ts`): compact pages one column at
 * a time under a switcher of column names with counts, medium scrolls a strip of columns that
 * snaps to a column, wide shows every column side by side. The columns are built once and move
 * between the three containers, so scroll position inside a column survives a resize.
 *
 * Arrow keys move focus between cards (up/down within a column, left/right to the next column
 * that has cards). Read-only in Phase 2: `writable` stays false and no card is draggable.
 * Phase 4 hooks in at {@link decorateCard}. Signal `card-activated(id)`.
 */
export class KanbanBoard extends Gtk.Box {
  static {
    GObject.registerClass(
      { GTypeName: 'GjsifyAdwKanbanBoard', Signals: { 'card-activated': { param_types: [GObject.TYPE_STRING] } } },
      KanbanBoard,
    );
  }

  private sizeClass: SizeClass = 'wide';
  private isWritable = false;
  private columns: BoardColumn[] = [];
  private toggles: Gtk.ToggleButton[] = [];
  private current = 0;
  private silent = false;
  private lastWidth = 0;
  private snapTimer = 0;
  private animation: Adw.TimedAnimation | null = null;
  private readonly switcher = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 });
  private readonly switcherScroll = new Gtk.ScrolledWindow({
    hscrollbarPolicy: Gtk.PolicyType.EXTERNAL,
    vscrollbarPolicy: Gtk.PolicyType.NEVER,
  });
  private readonly carousel = new Adw.Carousel({ spacing: COLUMN_GAP, vexpand: true, hexpand: true });
  private readonly strip = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: COLUMN_GAP });
  private readonly scroller = new Gtk.ScrolledWindow({
    hscrollbarPolicy: Gtk.PolicyType.AUTOMATIC,
    vscrollbarPolicy: Gtk.PolicyType.NEVER,
    vexpand: true,
    hexpand: true,
  });
  private readonly all = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: COLUMN_GAP, homogeneous: true });
  private readonly holder = new Adw.Bin({ vexpand: true, hexpand: true });
  private host: Gtk.Box | Adw.Carousel | null = null;

  constructor() {
    super({ orientation: Gtk.Orientation.VERTICAL, spacing: 0 });
    ensureStyles();
    this.switcher.set_margin_start(COLUMN_GAP);
    this.switcher.set_margin_end(COLUMN_GAP);
    this.switcher.set_margin_top(6);
    this.switcher.set_margin_bottom(6);
    this.switcherScroll.set_child(this.switcher);
    this.switcherScroll.set_visible(false);

    for (const box of [this.strip, this.all]) {
      box.set_margin_start(COLUMN_GAP);
      box.set_margin_end(COLUMN_GAP);
      box.set_margin_bottom(COLUMN_GAP);
    }
    this.carousel.set_margin_start(COLUMN_GAP);
    this.carousel.set_margin_end(COLUMN_GAP);
    this.carousel.set_margin_bottom(COLUMN_GAP);
    this.scroller.set_child(this.strip);

    this.append(this.switcherScroll);
    this.append(this.holder);

    this.carousel.connect('page-changed', (_c: Adw.Carousel, index: number) => this.pageChanged(index));
    this.scroller.get_hadjustment().connect('notify::value', () => this.scheduleSnap());
    this.add_tick_callback(() => {
      const width = this.get_width();
      if (width !== this.lastWidth) {
        this.lastWidth = width;
        this.sizeStrip();
      }
      return true;
    });

    const keys = new Gtk.EventControllerKey();
    keys.connect('key-pressed', (_k: Gtk.EventControllerKey, keyval: number) => this.onKey(keyval));
    this.add_controller(keys);
    this.place();
  }

  /** Phase 2 boards are read-only; Phase 4 sets this when the board's sources can be written. */
  get writable(): boolean {
    return this.isWritable;
  }

  set writable(value: boolean) {
    this.isWritable = value;
  }

  get presentation(): BoardPresentation {
    return boardPresentation(this.sizeClass);
  }

  get columnCount(): number {
    return this.columns.length;
  }

  setSizeClass(sizeClass: SizeClass): void {
    if (this.sizeClass === sizeClass) return;
    this.sizeClass = sizeClass;
    this.place();
  }

  setColumns(data: readonly BoardColumnData[], now: Date = new Date()): void {
    this.detach();
    this.columns = data.map((column) => {
      const widget = new BoardColumn();
      widget.setColumn(column, now);
      onSignal(widget, 'card-activated', (id: string) => emitSignal(this, 'card-activated', id));
      for (const card of widget.cards) this.decorateCard(card, widget);
      return widget;
    });
    this.current = clampColumn(this.current, this.columns.length);
    this.buildSwitcher(data);
    this.place();
  }

  /**
   * The Phase 4 seam: called once per card after it is built. Dragging attaches here
   * (`Gtk.DragSource` on the card, `Gtk.DropTarget` on `column.dropArea`), guarded by `canDrag`
   * from `board-rules.ts`; on touch the card detail offers "Move to …" instead.
   */
  protected decorateCard(_card: BoardCard, _column: BoardColumn): void {}

  /** The column shown first on a phone, or last visited. */
  showColumn(index: number): void {
    const column = clampColumn(index, this.columns.length);
    if (column < 0) return;
    this.current = column;
    this.syncToggles();
    this.scrollTo(column);
  }

  private place(): void {
    this.detach();
    const presentation = this.presentation;
    this.switcherScroll.set_visible(presentation === 'single' && this.columns.length > 0);
    switch (presentation) {
      case 'single':
        this.host = this.carousel;
        this.holder.set_child(this.carousel);
        for (const c of this.columns) this.carousel.append(c);
        break;
      case 'scroll':
        this.host = this.strip;
        this.holder.set_child(this.scroller);
        for (const c of this.columns) this.strip.append(c);
        break;
      case 'all':
        this.host = this.all;
        this.holder.set_child(this.all);
        for (const c of this.columns) this.all.append(c);
        break;
    }
    this.sizeStrip();
    this.syncToggles();
    const index = this.current;
    // After the new container has been measured, return to the column the reader was on.
    this.add_tick_callback(() => {
      this.scrollTo(index, false);
      return false;
    });
  }

  private detach(): void {
    const host = this.host;
    if (!host) return;
    for (const c of this.columns) {
      if (c.get_parent() === host) host.remove(c);
    }
  }

  private sizeStrip(): void {
    const width = columnWidth(this.sizeClass, this.get_width(), this.columns.length);
    for (const c of this.columns) c.set_size_request(width ?? -1, -1);
  }

  private buildSwitcher(data: readonly BoardColumnData[]): void {
    for (const t of this.toggles) this.switcher.remove(t);
    this.toggles = [];
    let first: Gtk.ToggleButton | null = null;
    data.forEach((column, index) => {
      const toggle = new Gtk.ToggleButton();
      const body = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 6 });
      const count = new Gtk.Label({ label: String(column.cards.length) });
      count.add_css_class('numeric');
      count.add_css_class('dim-label');
      body.append(new Gtk.Label({ label: column.title }));
      body.append(count);
      toggle.set_child(body);
      toggle.add_css_class('flat');
      toggle.update_property(
        [Gtk.AccessibleProperty.LABEL],
        [`${column.title}, ${cardCountText(column.cards.length)}`],
      );
      if (first) toggle.set_group(first);
      else first = toggle;
      toggle.connect('toggled', () => {
        if (this.silent || !toggle.active) return;
        this.current = index;
        this.scrollTo(index);
      });
      this.switcher.append(toggle);
      this.toggles.push(toggle);
    });
  }

  private syncToggles(): void {
    this.silent = true;
    this.toggles[this.current]?.set_active(true);
    this.silent = false;
  }

  private pageChanged(index: number): void {
    if (this.presentation !== 'single') return;
    this.current = clampColumn(index, this.columns.length);
    this.syncToggles();
  }

  private scrollTo(index: number, animate = true): void {
    const column = this.columns[index];
    if (!column) return;
    if (this.presentation === 'single') {
      if (column.get_parent() === this.carousel) this.carousel.scroll_to(column, animate);
    } else if (this.presentation === 'scroll') {
      const width = columnWidth(this.sizeClass, this.get_width(), this.columns.length) ?? 0;
      this.animateTo(columnOffset(index, width, this.columns.length), animate);
    }
  }

  private animateTo(target: number, animate: boolean): void {
    const adj = this.scroller.get_hadjustment();
    const to = Math.min(target, Math.max(0, adj.get_upper() - adj.get_page_size()));
    this.animation?.skip();
    if (!animate) {
      adj.set_value(to);
      return;
    }
    this.animation = new Adw.TimedAnimation({
      widget: this.scroller,
      valueFrom: adj.get_value(),
      valueTo: to,
      duration: 200,
      target: Adw.CallbackAnimationTarget.new((v: number) => adj.set_value(v)),
    });
    this.animation.play();
  }

  /** After a drag or flick comes to rest, settle on the nearest column start. */
  private scheduleSnap(): void {
    if (this.presentation !== 'scroll') return;
    if (this.animation && this.animation.get_state() === Adw.AnimationState.PLAYING) return;
    if (this.snapTimer) GLib.source_remove(this.snapTimer);
    this.snapTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 160, () => {
      this.snapTimer = 0;
      const width = columnWidth(this.sizeClass, this.get_width(), this.columns.length) ?? 0;
      const adj = this.scroller.get_hadjustment();
      const index = snapColumn(adj.get_value(), width, this.columns.length);
      this.current = Math.max(index, 0);
      this.animateTo(columnOffset(this.current, width, this.columns.length), true);
      return GLib.SOURCE_REMOVE;
    });
  }

  private onKey(keyval: number): boolean {
    const focus = (this.get_root() as Gtk.Window | null)?.get_focus();
    if (!focus) return false;
    let column = -1;
    let index = -1;
    this.columns.forEach((c, ci) => {
      const at = c.cards.findIndex((card) => card === focus);
      if (at >= 0) {
        column = ci;
        index = at;
      }
    });
    if (column < 0) return false;
    const sizes = this.columns.map((c) => c.cards.length);
    if (keyval === Gdk.KEY_Left || keyval === Gdk.KEY_Right) {
      const next = neighbourFocus(column, index, keyval === Gdk.KEY_Left ? -1 : 1, sizes);
      if (!next) return true;
      this.scrollTo(next.column);
      this.columns[next.column]?.cards[next.index]?.grab_focus();
      return true;
    }
    if (keyval === Gdk.KEY_Up || keyval === Gdk.KEY_Down) {
      const cards = this.columns[column]?.cards ?? [];
      cards[index + (keyval === Gdk.KEY_Up ? -1 : 1)]?.grab_focus();
      return true;
    }
    return false;
  }
}
