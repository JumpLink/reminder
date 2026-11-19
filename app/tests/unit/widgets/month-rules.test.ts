import { describe, expect, it } from '@gjsify/unit';
import {
  BAR_HEIGHT,
  MAX_BAR_ROWS,
  MAX_DOTS,
  barRows,
  dotsForDay,
  monthDensity,
  moveGridFocus,
} from '@gjsify/adwaita-extended/month-rules';

export default async () => {
  await describe('month rules', async () => {
    await it('shows dots where a cell is too narrow for a title', async () => {
      expect(monthDensity('compact')).toBe('dots');
      expect(monthDensity('medium')).toBe('bars');
      expect(monthDensity('wide')).toBe('bars');
    });

    await it('fits bar rows into the measured cell height', async () => {
      expect(barRows('compact', 400)).toBe(0);
      expect(barRows('medium')).toBe(2);
      expect(barRows('wide')).toBe(3);
      expect(barRows('wide', Number.NaN)).toBe(3);
      // A tall cell takes what fits, a short one keeps at least one row.
      expect(barRows('wide', 26 + 18 + BAR_HEIGHT * 3)).toBe(3);
      expect(barRows('wide', 40)).toBe(1);
      expect(barRows('wide', 10000)).toBe(MAX_BAR_ROWS);
    });

    await it('counts the dots a compact cell draws and what they leave out', async () => {
      expect(dotsForDay(0)).toStrictEqual({ dots: 0, more: 0 });
      expect(dotsForDay(2)).toStrictEqual({ dots: 2, more: 0 });
      expect(dotsForDay(MAX_DOTS)).toStrictEqual({ dots: MAX_DOTS, more: 0 });
      expect(dotsForDay(5)).toStrictEqual({ dots: 3, more: 2 });
      expect(dotsForDay(5, 1)).toStrictEqual({ dots: 1, more: 4 });
      expect(dotsForDay(-2)).toStrictEqual({ dots: 0, more: 0 });
      expect(dotsForDay(Number.NaN)).toStrictEqual({ dots: 0, more: 0 });
    });

    await it('moves the focus by day, by week and to the ends of a week', async () => {
      const count = 35;
      expect(moveGridFocus(8, 'left', count)).toBe(7);
      expect(moveGridFocus(8, 'right', count)).toBe(9);
      expect(moveGridFocus(8, 'up', count)).toBe(1);
      expect(moveGridFocus(8, 'down', count)).toBe(15);
      expect(moveGridFocus(8, 'home', count)).toBe(7);
      expect(moveGridFocus(8, 'end', count)).toBe(13);
      // Left and right cross the week boundary; up and down off the grid do not wrap.
      expect(moveGridFocus(7, 'left', count)).toBe(6);
      expect(moveGridFocus(0, 'left', count)).toBe(-1);
      expect(moveGridFocus(count - 1, 'right', count)).toBe(-1);
      expect(moveGridFocus(3, 'up', count)).toBe(-1);
      expect(moveGridFocus(count - 3, 'down', count)).toBe(-1);
      expect(moveGridFocus(-1, 'left', count)).toBe(-1);
      expect(moveGridFocus(count, 'left', count)).toBe(-1);
      // A short last row: End stops at the last cell there is.
      expect(moveGridFocus(28, 'end', 31)).toBe(30);
    });
  });
};
