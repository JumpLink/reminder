import { describe, expect, it } from '@gjsify/unit';
import {
  commitDistance,
  POINTER_ROW_HEIGHT,
  POINTER_ROW_HEIGHT_COMPACT,
  rowMinHeight,
  swipeOutcome,
  TOUCH_TARGET,
} from '@gjsify/adwaita-extended/swipe-rules';

export default async () => {
  await describe('swipeOutcome', async () => {
    await it('commits at 35% of the width', async () => {
      expect(commitDistance(400)).toBe(140);
      expect(swipeOutcome(139, 400)).toBe('none');
      expect(swipeOutcome(140, 400)).toBe('primary');
      expect(swipeOutcome(-139, 400)).toBe('none');
      expect(swipeOutcome(-140, 400)).toBe('secondary');
    });

    await it('never commits under the pixel floor on a narrow row', async () => {
      expect(commitDistance(100)).toBe(72);
      expect(swipeOutcome(71, 100)).toBe('none');
      expect(swipeOutcome(72, 100)).toBe('primary');
    });

    await it('is none for a rest, or nonsense input', async () => {
      expect(swipeOutcome(0, 400)).toBe('none');
      expect(swipeOutcome(500, 0)).toBe('none');
      expect(swipeOutcome(Number.NaN, 400)).toBe('none');
    });
  });

  await describe('rowMinHeight', async () => {
    await it('gives touch 48, a pointer less', async () => {
      expect(TOUCH_TARGET).toBe(48);
      expect(rowMinHeight('compact', false)).toBe(48);
      expect(rowMinHeight('wide', false)).toBe(48);
      expect(rowMinHeight('compact', true)).toBe(POINTER_ROW_HEIGHT_COMPACT);
      expect(rowMinHeight('wide', true)).toBe(POINTER_ROW_HEIGHT);
      expect(POINTER_ROW_HEIGHT < POINTER_ROW_HEIGHT_COMPACT && POINTER_ROW_HEIGHT_COMPACT < 48).toBe(true);
    });
  });
};
