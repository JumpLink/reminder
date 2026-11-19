import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';

import { BoardCard, type BoardCardData } from './board-card.ts';
import { _, _n } from './i18n.ts';
import { emitSignal, onSignal } from './signals.ts';
import { ELLIPSIZE_END, ensureStyles } from './styles.ts';

export interface BoardColumnData {
  id: string;
  title: string;
  cards: readonly BoardCardData[];
}

/** "3 cards", for the accessible name of a column and its switcher button. */
export function cardCountText(count: number): string {
  return _n('%d card', '%d cards', count).replace('%d', String(count));
}

/**
 * One column: a header with the title and the card count, then its own scrolling list of cards.
 * An empty column shows a quiet line, not a status page. Signal `card-activated(id)`.
 */
export class BoardColumn extends Gtk.Box {
  static {
    GObject.registerClass(
      { GTypeName: 'GjsifyAdwBoardColumn', Signals: { 'card-activated': { param_types: [GObject.TYPE_STRING] } } },
      BoardColumn,
    );
  }

  private columnId = '';
  private heading = '';
  private readonly titleLabel = new Gtk.Label({ xalign: 0, hexpand: true, ellipsize: ELLIPSIZE_END, singleLineMode: true });
  private readonly count = new Gtk.Label({ valign: Gtk.Align.CENTER });
  private readonly list = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });
  private readonly empty = new Gtk.Label({ label: _('No cards'), vexpand: false });
  private cardWidgets: BoardCard[] = [];

  constructor() {
    super({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, vexpand: true });
    ensureStyles();
    this.add_css_class('gjsify-board-column');
    this.titleLabel.add_css_class('heading');
    this.count.add_css_class('caption-heading');
    this.count.add_css_class('numeric');
    this.count.add_css_class('dim-label');
    this.empty.add_css_class('dim-label');
    this.empty.set_margin_top(24);
    this.empty.set_margin_bottom(24);

    const head = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 8 });
    head.set_margin_start(12);
    head.set_margin_end(12);
    head.set_margin_top(10);
    head.set_margin_bottom(6);
    head.append(this.titleLabel);
    head.append(this.count);

    this.list.set_margin_start(8);
    this.list.set_margin_end(8);
    this.list.set_margin_bottom(8);
    this.list.append(this.empty);
    const scroller = new Gtk.ScrolledWindow({
      hscrollbarPolicy: Gtk.PolicyType.NEVER,
      vexpand: true,
      propagateNaturalHeight: false,
    });
    scroller.set_child(this.list);
    this.append(head);
    this.append(scroller);
  }

  get id(): string {
    return this.columnId;
  }

  get title(): string {
    return this.heading;
  }

  /** The cards in order; the board moves focus between them and Phase 4 decorates them. */
  get cards(): readonly BoardCard[] {
    return this.cardWidgets;
  }

  /** The widget a Phase 4 drop target attaches to: the box that holds the cards. */
  get dropArea(): Gtk.Widget {
    return this.list;
  }

  setColumn(column: BoardColumnData, now: Date = new Date()): void {
    this.columnId = column.id;
    this.heading = column.title;
    this.titleLabel.set_label(column.title);
    this.count.set_label(String(column.cards.length));
    this.update_property(
      [Gtk.AccessibleProperty.LABEL],
      [`${column.title}, ${cardCountText(column.cards.length)}`],
    );
    for (const card of this.cardWidgets) this.list.remove(card);
    this.cardWidgets = column.cards.map((data) => {
      const card = new BoardCard();
      card.setCard(data, now);
      onSignal(card, 'card-activated', (id: string) => emitSignal(this, 'card-activated', id));
      this.list.append(card);
      return card;
    });
    this.empty.set_visible(column.cards.length === 0);
  }
}
