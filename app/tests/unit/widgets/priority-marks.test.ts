import { describe, expect, it } from '@gjsify/unit';
import { priorityLevel, priorityMarks } from '@gjsify/adwaita-extended/priority-marks';

export default async () => {
  await describe('priorityMarks', async () => {
    await it('maps 1–4 to !!!', async () => {
      for (const p of [1, 2, 3, 4]) expect(priorityMarks(p)).toBe('!!!');
    });

    await it('maps 5 to !! and 6–9 to !', async () => {
      expect(priorityMarks(5)).toBe('!!');
      for (const p of [6, 7, 8, 9]) expect(priorityMarks(p)).toBe('!');
    });

    await it('shows nothing for 0, absent or out-of-range values', async () => {
      for (const p of [0, null, undefined, -1, 10, 2.5, Number.NaN]) expect(priorityMarks(p)).toBe('');
      expect(priorityLevel(0)).toBe('none');
    });

    await it('names the level', async () => {
      expect(priorityLevel(1)).toBe('high');
      expect(priorityLevel(5)).toBe('medium');
      expect(priorityLevel(9)).toBe('low');
    });
  });
};
