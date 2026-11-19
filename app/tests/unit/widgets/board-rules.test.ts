import { describe, expect, it } from '@gjsify/unit';
import {
  COLUMN_GAP,
  COLUMN_PEEK,
  MIN_COLUMN_WIDTH,
  boardPresentation,
  canDrag,
  clampColumn,
  columnOffset,
  columnWidth,
  neighbourFocus,
  snapColumn,
  visibleColumns,
} from '@gjsify/adwaita-extended/board-rules';

export default async () => {
  await describe('board rules', async () => {
    await it('presents one column, a strip or all by size class', async () => {
      expect(boardPresentation('compact')).toBe('single');
      expect(boardPresentation('medium')).toBe('scroll');
      expect(boardPresentation('wide')).toBe('all');
    });

    await it('counts the columns on screen', async () => {
      expect(visibleColumns('compact', 4)).toBe(1);
      expect(visibleColumns('medium', 4)).toBe(2);
      expect(visibleColumns('medium', 1)).toBe(1);
      expect(visibleColumns('wide', 4)).toBe(4);
      expect(visibleColumns('wide', 0)).toBe(0);
      expect(visibleColumns('wide', Number.NaN)).toBe(0);
    });

    await it('sizes a strip column so two and a peek fill the width', async () => {
      const w = columnWidth('medium', 800, 4) as number;
      expect(w).toBe(Math.floor((800 - COLUMN_GAP * 3 - COLUMN_PEEK) / 2));
      expect(columnWidth('medium', 800, 2)).toBe(Math.floor((800 - COLUMN_GAP * 3) / 2));
      expect(columnWidth('medium', 300, 4)).toBe(MIN_COLUMN_WIDTH);
      expect(columnWidth('compact', 400, 4)).toBe(null);
      expect(columnWidth('medium', 800, 0)).toBe(null);
    });

    await it('shares the width among every column when they all show', async () => {
      // No peek: nothing is scrolled past, the columns simply divide the room.
      expect(columnWidth('wide', 1280, 4)).toBe(Math.floor((1280 - COLUMN_GAP * 5) / 4));
      // An inspector took its share, so the columns shrink — down to the floor, then they scroll.
      expect(columnWidth('wide', 1100, 4)).toBe(Math.floor((1100 - COLUMN_GAP * 5) / 4));
      expect(columnWidth('wide', 600, 5)).toBe(MIN_COLUMN_WIDTH);
    });

    await it('clamps a column index', async () => {
      expect(clampColumn(-3, 4)).toBe(0);
      expect(clampColumn(9, 4)).toBe(3);
      expect(clampColumn(2, 4)).toBe(2);
      expect(clampColumn(1, 0)).toBe(-1);
      expect(clampColumn(Number.NaN, 4)).toBe(-1);
    });

    await it('snaps a scroll offset to the nearest column start', async () => {
      const pitch = 300 + COLUMN_GAP;
      expect(columnOffset(2, 300, 4)).toBe(2 * pitch);
      expect(columnOffset(9, 300, 4)).toBe(3 * pitch);
      expect(snapColumn(0, 300, 4)).toBe(0);
      expect(snapColumn(pitch * 1.4, 300, 4)).toBe(1);
      expect(snapColumn(pitch * 1.6, 300, 4)).toBe(2);
      expect(snapColumn(pitch * 9, 300, 4)).toBe(3);
      expect(snapColumn(50, 0, 4)).toBe(0);
    });

    await it('moves focus sideways to the next column that has cards', async () => {
      const sizes = [3, 0, 2, 1];
      const right = neighbourFocus(0, 2, 1, sizes);
      expect(right?.column).toBe(2);
      expect(right?.index).toBe(1);
      const left = neighbourFocus(3, 0, -1, sizes);
      expect(left?.column).toBe(2);
      expect(left?.index).toBe(0);
      expect(neighbourFocus(3, 0, 1, sizes)).toBe(null);
      expect(neighbourFocus(0, 0, 0, sizes)).toBe(null);
      expect(neighbourFocus(0, 0, -1, sizes)).toBe(null);
    });

    await it('allows a drag only on a writable board and a writable card', async () => {
      expect(canDrag(false, true)).toBe(true);
      expect(canDrag(true, true)).toBe(false);
      expect(canDrag(false, false)).toBe(false);
    });
  });
};
