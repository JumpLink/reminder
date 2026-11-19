/**
 * The time grid's geometry in pixels: how a minute becomes a y offset and back, and how an overlap
 * column becomes an x offset. Pure and Node-safe — the widget only hands these numbers to GTK.
 */

import { MINUTES_PER_DAY } from '@gjsify/calendar-layout';

/** Height of one hour, px. An hour has to stay tall enough for a title and a time to fit. */
export const HOUR_HEIGHT = 48;
/** Width of the hour gutter beside the columns, px; the headers above reserve the same. */
export const GUTTER_WIDTH = 56;
/** A click on free space rounds down to this, so a slot starts at a quarter of an hour. */
export const SLOT_MINUTES = 15;
/** Narrower than this a day column stops being readable, and the grid scrolls sideways instead. */
export const MIN_DAY_WIDTH = 96;
/** A gap between two items in the same overlap cluster, px, so their edges stay apart. */
export const EVENT_GAP = 2;
/** A week is the widest the grid goes; more days belong in the month grid. */
export const MAX_DAYS = 7;

/** 1 to {@link MAX_DAYS} day columns; anything else lands on the nearest end. */
export function clampDays(days: number): number {
  if (!Number.isFinite(days)) return 1;
  return Math.max(1, Math.min(MAX_DAYS, Math.floor(days)));
}

/** A visible range that `layoutTimeGrid` accepts: whole hours, start before end, inside the day. */
export function visibleRange(startHour?: number, endHour?: number): { startHour: number; endHour: number } {
  const start = Math.max(0, Math.min(23, Math.floor(startHour ?? 0)));
  const end = Math.max(start + 1, Math.min(24, Math.ceil(endHour ?? 24)));
  return { startHour: start, endHour: end };
}

/** Height of the whole scrolling area, px. */
export function gridHeight(startHour: number, endHour: number): number {
  const range = visibleRange(startHour, endHour);
  return (range.endHour - range.startHour) * HOUR_HEIGHT;
}

/** Where a minute of the day sits in the scrolling area, px from its top. */
export function offsetForMinute(minute: number, startHour: number): number {
  return ((minute - startHour * 60) / 60) * HOUR_HEIGHT;
}

/** The slot a click at `y` px opens: the minute of the day, rounded down to `snap`. */
export function minuteAtOffset(y: number, startHour: number, snap: number = SLOT_MINUTES): number {
  if (!Number.isFinite(y)) return startHour * 60;
  const raw = startHour * 60 + (y / HOUR_HEIGHT) * 60;
  const step = Math.max(1, Math.floor(snap));
  const snapped = Math.floor(raw / step) * step;
  return Math.max(0, Math.min(MINUTES_PER_DAY - step, snapped));
}

/** Where the now line goes, or `null` when the current minute is outside the visible hours. */
export function nowOffset(minute: number, startHour: number, endHour: number): number | null {
  const range = visibleRange(startHour, endHour);
  if (minute < range.startHour * 60 || minute > range.endHour * 60) return null;
  return offsetForMinute(minute, range.startHour);
}

/** The slice of a day column's width an item in overlap column `column` of `columns` gets. */
export function columnBounds(column: number, columns: number, width: number): { x: number; width: number } {
  const total = Math.max(1, Math.floor(columns));
  const index = Math.max(0, Math.min(total - 1, Math.floor(column)));
  const x = Math.round((index / total) * width);
  const next = Math.round(((index + 1) / total) * width);
  const gap = total > 1 ? EVENT_GAP : 0;
  return { x, width: Math.max(1, next - x - gap) };
}

/** The scroll position that brings `hour` to the top of a viewport `viewportHeight` px tall. */
export function scrollTarget(hour: number, startHour: number, endHour: number, viewportHeight: number): number {
  const range = visibleRange(startHour, endHour);
  const max = Math.max(0, gridHeight(range.startHour, range.endHour) - Math.max(0, viewportHeight));
  return Math.max(0, Math.min(max, (hour - range.startHour) * HOUR_HEIGHT));
}
