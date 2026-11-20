import { describe, expect, it } from '@gjsify/unit';
import {
  HOUR_HEIGHT,
  MAX_DAYS,
  MAX_UNITS,
  SLOT_MINUTES,
  clampDays,
  columnUnits,
  gridHeight,
  gridSlot,
  minuteAtOffset,
  nowOffset,
  offsetForMinute,
  scrollTarget,
  visibleRange,
} from '@gjsify/adwaita-extended/time-grid-rules';

export default async () => {
  await describe('time grid rules', async () => {
    await it('holds the day count between one day and a week', async () => {
      expect(clampDays(1)).toBe(1);
      expect(clampDays(3)).toBe(3);
      expect(clampDays(7)).toBe(MAX_DAYS);
      expect(clampDays(9)).toBe(MAX_DAYS);
      expect(clampDays(0)).toBe(1);
      expect(clampDays(2.7)).toBe(2);
      expect(clampDays(Number.NaN)).toBe(1);
    });

    await it('repairs a visible range the caller got wrong', async () => {
      expect(visibleRange(8, 20)).toStrictEqual({ startHour: 8, endHour: 20 });
      expect(visibleRange()).toStrictEqual({ startHour: 0, endHour: 24 });
      expect(visibleRange(-4, 30)).toStrictEqual({ startHour: 0, endHour: 24 });
      // An end at or before the start would make a grid of zero height.
      expect(visibleRange(20, 20)).toStrictEqual({ startHour: 20, endHour: 21 });
      expect(visibleRange(23, 2)).toStrictEqual({ startHour: 23, endHour: 24 });
      expect(visibleRange(7.4, 19.2)).toStrictEqual({ startHour: 7, endHour: 20 });
    });

    await it('maps minutes to pixels and a click back to a slot', async () => {
      expect(gridHeight(0, 24)).toBe(24 * HOUR_HEIGHT);
      expect(gridHeight(8, 20)).toBe(12 * HOUR_HEIGHT);
      expect(offsetForMinute(8 * 60, 8)).toBe(0);
      expect(offsetForMinute(9 * 60, 8)).toBe(HOUR_HEIGHT);
      expect(offsetForMinute(8 * 60 + 30, 8)).toBe(HOUR_HEIGHT / 2);
      expect(minuteAtOffset(0, 8)).toBe(8 * 60);
      expect(minuteAtOffset(HOUR_HEIGHT, 8)).toBe(9 * 60);
      // Anywhere inside a quarter hour opens that quarter hour.
      expect(minuteAtOffset(HOUR_HEIGHT + 1, 8)).toBe(9 * 60);
      expect(minuteAtOffset(HOUR_HEIGHT * 1.3, 8)).toBe(9 * 60 + 15);
      expect(minuteAtOffset(Number.NaN, 8)).toBe(8 * 60);
      expect(minuteAtOffset(HOUR_HEIGHT * 100, 0)).toBe(1440 - SLOT_MINUTES);
    });

    await it('places the now line only inside the visible hours', async () => {
      expect(nowOffset(9 * 60, 8, 20)).toBe(HOUR_HEIGHT);
      expect(nowOffset(8 * 60, 8, 20)).toBe(0);
      expect(nowOffset(7 * 60, 8, 20)).toBeNull();
      expect(nowOffset(21 * 60, 8, 20)).toBeNull();
    });

    await it('splits a day column into slots every cluster divides', async () => {
      expect(columnUnits([])).toBe(1);
      expect(columnUnits([1, 1])).toBe(1);
      expect(columnUnits([1, 2])).toBe(2);
      expect(columnUnits([2, 3])).toBe(6);
      expect(columnUnits([2, 3, 4])).toBe(12);
      // Nonsense counts round into the range rather than poisoning the multiple.
      expect(columnUnits([0, -4, Number.NaN, 3])).toBe(3);
      // Beyond the cap the slots stop growing; an item then loses a few at the right edge.
      expect(columnUnits([7, 8, 9])).toBe(MAX_UNITS);
    });

    await it('gives an item the slots of its overlap column', async () => {
      expect(gridSlot(0, 1, 6)).toStrictEqual({ start: 0, span: 6 });
      expect(gridSlot(0, 2, 6)).toStrictEqual({ start: 0, span: 3 });
      expect(gridSlot(1, 2, 6)).toStrictEqual({ start: 3, span: 3 });
      expect(gridSlot(2, 3, 6)).toStrictEqual({ start: 4, span: 2 });
      // 60 slots do not divide by 7, so the last column keeps its span and stops short.
      expect(gridSlot(6, 7, 60)).toStrictEqual({ start: 48, span: 8 });
      // A column index outside the cluster lands on its last column rather than off the grid.
      expect(gridSlot(9, 2, 6)).toStrictEqual({ start: 3, span: 3 });
      expect(gridSlot(0, 0, 6)).toStrictEqual({ start: 0, span: 6 });
    });

    await it('scrolls an hour to the top, as far as the content allows', async () => {
      expect(scrollTarget(8, 0, 24, 600)).toBe(8 * HOUR_HEIGHT);
      expect(scrollTarget(0, 0, 24, 600)).toBe(0);
      expect(scrollTarget(-3, 0, 24, 600)).toBe(0);
      // The last hours cannot reach the top: the content below them has run out.
      expect(scrollTarget(23, 0, 24, 600)).toBe(24 * HOUR_HEIGHT - 600);
      expect(scrollTarget(8, 0, 24, 10000)).toBe(0);
    });
  });
};
