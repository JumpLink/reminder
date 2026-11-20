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
  dropIndex,
  dropPlacement,
  moveColumn,
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

    await it('splits each card at its middle to find the drop index', async () => {
      const extents = [
        { top: 0, height: 100 },
        { top: 108, height: 60 },
        { top: 176, height: 60 },
      ];
      expect(dropIndex(0, extents)).toBe(0);
      expect(dropIndex(49, extents)).toBe(0);
      expect(dropIndex(50, extents)).toBe(1);
      expect(dropIndex(137, extents)).toBe(1);
      expect(dropIndex(138, extents)).toBe(2);
      expect(dropIndex(500, extents)).toBe(3);
      expect(dropIndex(-20, extents)).toBe(0);
    });

    await it('drops into an empty column at the front', async () => {
      expect(dropIndex(0, [])).toBe(0);
      expect(dropIndex(400, [])).toBe(0);
      expect(dropIndex(Number.NaN, [])).toBe(0);
    });

    await it('takes the dragged card out of the count within its own column', async () => {
      // Three cards, dragging the middle one: the raw index counts it, the position must not.
      expect(dropPlacement(true, 1, 0)).toBe(0);
      expect(dropPlacement(true, 1, 1)).toBe(null);
      expect(dropPlacement(true, 1, 2)).toBe(null);
      expect(dropPlacement(true, 1, 3)).toBe(2);
      expect(dropPlacement(true, 0, 0)).toBe(null);
      expect(dropPlacement(true, 2, 0)).toBe(0);
    });

    await it('keeps the raw index when the card changes column', async () => {
      expect(dropPlacement(false, 1, 0)).toBe(0);
      expect(dropPlacement(false, 1, 2)).toBe(2);
      expect(dropPlacement(false, -1, 3)).toBe(3);
      expect(dropPlacement(false, 0, -2)).toBe(0);
    });

    await it('moves a card one column sideways and stops at both ends', async () => {
      expect(moveColumn(0, 1, 4)).toBe(1);
      expect(moveColumn(3, 1, 4)).toBe(null);
      expect(moveColumn(0, -1, 4)).toBe(null);
      expect(moveColumn(2, -1, 4)).toBe(1);
      expect(moveColumn(2, 3, 4)).toBe(3);
      expect(moveColumn(1, 0, 4)).toBe(null);
      expect(moveColumn(0, 1, 0)).toBe(null);
    });
  });
};
