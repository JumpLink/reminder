import GObject from '@girs/gobject-2.0';
import Gtk from '@girs/gtk-4.0';

import {
  dateFromDayNumber,
  dayNumber,
  isBarItem,
  itemDayRange,
  layoutTimeGrid,
  type LocalDate,
  type TimeGridDay,
  type TimePlacement,
} from '@gjsify/calendar-layout';

import type { CalendarEvent } from './calendar-event.ts';
import { hourLabel, isoDate, parseIsoDate, shortDayHeading, timeRangeLabel } from './calendar-format.ts';
import { _ } from './i18n.ts';
import { emitSignal } from './signals.ts';
import { ELLIPSIZE_END, ensureStyles } from './styles.ts';
import { Tint } from './tint.ts';
import {
  GUTTER_WIDTH,
  HOUR_HEIGHT,
  MIN_DAY_WIDTH,
  clampDays,
  columnBounds,
  gridHeight,
  minuteAtOffset,
  nowOffset,
  offsetForMinute,
  scrollTarget,
  visibleRange,
} from './time-grid-rules.ts';

/**
 * One to seven day columns over an hour gutter: the day, the week, or anything between.
 *
 * `@gjsify/calendar-layout` decides which item sits in which overlap column; `time-grid-rules`
 * turns minutes and columns into pixels. This widget places the children at those coordinates in a
 * `Gtk.Fixed` per day, because a timed grid has no row structure a box could express — two items
 * at 09:00 and 09:15 overlap by a quarter of their heights.
 *
 * All-day and multi-day items never reach the columns (`layoutTimeGrid` drops them); they go into
 * the strip above, which is why the strip exists rather than being the host's problem.
 *
 * Signals: `item-activated(id)` from a click on an item or the strip; `slot-activated(date, minute)`
 * from a click on free space, with a `YYYY-MM-DD` date and the minute of the day, snapped down to
 * a quarter of an hour.
 */
export class TimeGrid extends Gtk.Box {
  static {
    GObject.registerClass(
      {
        GTypeName: 'GjsifyAdwTimeGrid',
        Signals: {
          'item-activated': { param_types: [GObject.TYPE_STRING] },
          'slot-activated': { param_types: [GObject.TYPE_STRING, GObject.TYPE_INT] },
        },
      },
      TimeGrid,
    );
  }

  private firstDay: LocalDate = today();
  private dayCount = 7;
  private startHour = 0;
  private endHour = 24;
  private items: readonly CalendarEvent[] = [];
  private localeName: string | undefined;
  private todayKey: number | null = null;
  private nowMinute: number | null = null;

  private readonly headerRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0 });
  private readonly stripRow = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0 });
  private readonly stripLabel = new Gtk.Label({
    label: _('All day'),
    widthRequest: GUTTER_WIDTH,
    xalign: 1,
    valign: Gtk.Align.START,
  });
  private readonly gutter = new Gtk.Fixed({ widthRequest: GUTTER_WIDTH });
  private readonly columns = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0, hexpand: true });
  private readonly body = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL, spacing: 0 });
  private readonly scroller = new Gtk.ScrolledWindow({ hscrollbarPolicy: Gtk.PolicyType.AUTOMATIC, vexpand: true });

  constructor() {
    super({ orientation: Gtk.Orientation.VERTICAL, spacing: 0, hexpand: true, vexpand: true });
    ensureStyles();
    this.stripLabel.add_css_class('caption');
    this.stripLabel.add_css_class('dim-label');
    this.stripLabel.set_margin_end(6);
    this.stripLabel.set_margin_top(4);
    this.stripRow.add_css_class('gjsify-time-strip');
    this.body.append(this.gutter);
    this.body.append(this.columns);
    this.scroller.set_child(this.body);
    this.append(this.headerRow);
    this.append(this.stripRow);
    this.append(this.scroller);
    this.refresh();
  }

  /** The first day on screen, as `YYYY-MM-DD`. */
  get firstDate(): string {
    return isoDate(this.firstDay);
  }

  /** The days on screen, as `YYYY-MM-DD`; a host puts the ends of this in its header. */
  get dates(): string[] {
    const start = dayNumber(this.firstDay);
    return Array.from({ length: this.dayCount }, (_u, index) => isoDate(dateFromDayNumber(start + index)));
  }

  /** The first column and how many follow it, 1…7. */
  setRange(firstDay: string, days: number): void {
    const parsed = parseIsoDate(firstDay);
    if (parsed !== null) this.firstDay = parsed;
    this.dayCount = clampDays(days);
    this.refresh();
  }

  /** The hours the grid shows; outside them an item is clipped, not dropped. */
  setVisibleHours(startHour: number, endHour: number): void {
    const range = visibleRange(startHour, endHour);
    this.startHour = range.startHour;
    this.endHour = range.endHour;
    this.refresh();
  }

  /** Already-expanded occurrences; everything outside the range is ignored. */
  setItems(items: readonly CalendarEvent[]): void {
    this.items = items;
    this.refresh();
  }

  setLocale(locale: string | undefined): void {
    this.localeName = locale;
    this.refresh();
  }

  /**
   * Where the now line goes, or `null` for no line — a story and a screenshot pass `null` so they
   * do not depend on the clock. The widget never reads the clock itself: a line that moves on its
   * own would need a timer nobody can stop from outside.
   */
  setNow(now: Date | null): void {
    if (now === null) {
      this.todayKey = null;
      this.nowMinute = null;
    } else {
      this.todayKey = dayNumber({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
      this.nowMinute = now.getHours() * 60 + now.getMinutes();
    }
    this.refresh();
  }

  /** Brings `hour` to the top of the viewport, as far as the content allows. */
  scrollToHour(hour: number): void {
    const adjustment = this.scroller.get_vadjustment();
    const target = scrollTarget(hour, this.startHour, this.endHour, adjustment.get_page_size());
    adjustment.set_value(target);
  }

  private refresh(): void {
    const start = dayNumber(this.firstDay);
    const days = layoutTimeGrid(this.items, {
      firstDay: this.firstDay,
      days: this.dayCount,
      startHour: this.startHour,
      endHour: this.endHour,
    });
    const height = gridHeight(this.startHour, this.endHour);

    clear(this.headerRow);
    clear(this.stripRow);
    clear(this.columns);
    clearFixed(this.gutter);

    const headerSpacer = new Gtk.Box({ widthRequest: GUTTER_WIDTH });
    this.headerRow.append(headerSpacer);
    this.stripRow.append(this.stripLabel);

    for (let hour = this.startHour; hour < this.endHour; hour++) {
      const label = new Gtk.Label({ label: hourLabel(hour, this.localeName), xalign: 1, widthRequest: GUTTER_WIDTH - 6 });
      label.add_css_class('caption');
      label.add_css_class('dim-label');
      label.add_css_class('numeric');
      this.gutter.put(label, 0, offsetForMinute(hour * 60, this.startHour) - 1);
    }
    this.gutter.set_size_request(GUTTER_WIDTH, height);

    for (let index = 0; index < this.dayCount; index++) {
      const date = dateFromDayNumber(start + index);
      this.headerRow.append(this.buildHeader(date));
      this.stripRow.append(this.buildStrip(date));
      this.columns.append(this.buildColumn(date, days[index], height, index > 0));
    }
  }

  private buildHeader(date: LocalDate): Gtk.Widget {
    const label = new Gtk.Label({
      label: shortDayHeading(date, this.localeName),
      hexpand: true,
      singleLineMode: true,
      ellipsize: ELLIPSIZE_END,
    });
    label.add_css_class('caption-heading');
    label.set_margin_top(4);
    label.set_margin_bottom(4);
    if (dayNumber(date) === this.todayKey) label.add_css_class('accent');
    else label.add_css_class('dim-label');
    return label;
  }

  /** The all-day strip for one day: the items `layoutTimeGrid` does not place, stacked. */
  private buildStrip(date: LocalDate): Gtk.Widget {
    const key = dayNumber(date);
    const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 2, hexpand: true });
    box.set_margin_start(1);
    box.set_margin_end(1);
    box.set_margin_top(2);
    box.set_margin_bottom(2);
    for (const item of this.items) {
      if (!isBarItem(item)) continue;
      const range = itemDayRange(item);
      if (key < range.first || key > range.last) continue;
      box.append(this.buildItem(item.id, item.payload.title, item.payload.colour ?? null, item.payload.title, 'month-bar'));
    }
    return box;
  }

  private buildColumn(date: LocalDate, day: TimeGridDay<unknown> | undefined, height: number, border: boolean): Gtk.Widget {
    const fixed = new Gtk.Fixed({ hexpand: true, widthRequest: MIN_DAY_WIDTH });
    fixed.set_size_request(MIN_DAY_WIDTH, height);
    if (border) fixed.add_css_class('gjsify-time-column');

    for (let hour = this.startHour + 1; hour < this.endHour; hour++) {
      const line = new Gtk.Box({ heightRequest: 1 });
      line.add_css_class('gjsify-time-hour');
      fixed.put(line, 0, offsetForMinute(hour * 60, this.startHour));
      // Hour lines have to follow the column's width, which `Gtk.Fixed` does not do for a child.
      fixed.connect('notify::width', () => line.set_size_request(Math.max(1, fixed.get_width()), 1));
    }

    const placements = day?.placements ?? [];
    for (const placement of placements) fixed.put(this.buildPlacement(placement, fixed), 0, 0);

    if (this.nowMinute !== null && dayNumber(date) === this.todayKey) {
      const offset = nowOffset(this.nowMinute, this.startHour, this.endHour);
      if (offset !== null) {
        const line = new Gtk.Box({ heightRequest: 2 });
        line.add_css_class('gjsify-time-now');
        line.set_can_target(false);
        fixed.put(line, 0, offset);
        fixed.connect('notify::width', () => line.set_size_request(Math.max(1, fixed.get_width()), 2));
      }
    }

    const click = new Gtk.GestureClick();
    click.connect('released', (_g: Gtk.GestureClick, _presses: number, _x: number, y: number) => {
      emitSignal(this, 'slot-activated', isoDate(date), minuteAtOffset(y, this.startHour));
    });
    fixed.add_controller(click);
    return fixed;
  }

  private buildPlacement(placement: TimePlacement<unknown>, parent: Gtk.Fixed): Gtk.Widget {
    const data = (placement.item as CalendarEvent).payload;
    const name = `${timeRangeLabel(placement.start, placement.end, this.localeName)} ${data.title}`;
    const button = this.buildItem(placement.id, data.title, data.colour ?? null, name, 'time-event');
    const height = Math.max(
      HOUR_HEIGHT / 4,
      offsetForMinute(placement.end, this.startHour) - offsetForMinute(placement.start, this.startHour) - 1,
    );
    button.set_size_request(MIN_DAY_WIDTH, height);
    // The slice a `Gtk.Fixed` child gets depends on the column's width, which is only known once
    // it is allocated — and changes with every resize, so this follows rather than measures once.
    const place = (): void => {
      const width = parent.get_width();
      if (width <= 0) return;
      const bounds = columnBounds(placement.column, placement.columns, width);
      button.set_size_request(bounds.width, height);
      parent.move(button, bounds.x, offsetForMinute(placement.start, this.startHour));
    };
    parent.connect('notify::width', place);
    button.connect('map', place);
    return button;
  }

  private buildItem(id: string, title: string, colour: string | null, name: string, kind: string): Gtk.Button {
    const button = new Gtk.Button();
    button.add_css_class('flat');
    button.add_css_class(kind === 'time-event' ? 'gjsify-time-event' : 'gjsify-month-bar');
    const label = new Gtk.Label({
      label: title,
      xalign: 0,
      yalign: 0,
      hexpand: true,
      ellipsize: ELLIPSIZE_END,
      singleLineMode: true,
    });
    label.add_css_class('caption');
    button.set_child(label);
    button.update_property([Gtk.AccessibleProperty.LABEL], [name]);
    button.set_tooltip_text(name);
    const tint = new Tint(button, 'cal-bar', (cls, c) => `.${cls} { background-color: color-mix(in srgb, ${c} 28%, transparent); }`);
    tint.set(colour);
    button.connect('clicked', () => emitSignal(this, 'item-activated', id));
    return button;
  }
}

function today(): LocalDate {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function clear(widget: Gtk.Box): void {
  let child = widget.get_first_child();
  while (child) {
    const next = child.get_next_sibling();
    widget.remove(child);
    child = next;
  }
}

function clearFixed(widget: Gtk.Fixed): void {
  let child = widget.get_first_child();
  while (child) {
    const next = child.get_next_sibling();
    widget.remove(child);
    child = next;
  }
}

/** Re-exported so a host can size its own header beside the grid without the rules module. */
export { GUTTER_WIDTH, HOUR_HEIGHT };
