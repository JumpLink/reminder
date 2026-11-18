import { describe, expect, it } from '@gjsify/unit';
import { dueState } from '@gjsify/adwaita-extended/due-state';

// Local-time constructors on purpose: the state is a difference in the reader's calendar days, and
// CI runs this in two zones on opposite sides of UTC.
export default async () => {
  await describe('dueState', async () => {
    const now = new Date(2026, 9, 10, 15, 30);

    await it('has no state without a date', async () => {
      expect(dueState(null, now)).toBe('none');
      expect(dueState(new Date('nope'), now)).toBe('none');
    });

    await it('compares calendar days, not hours', async () => {
      expect(dueState(new Date(2026, 9, 10, 0, 0), now)).toBe('today');
      expect(dueState(new Date(2026, 9, 10, 23, 59), now)).toBe('today');
      expect(dueState(new Date(2026, 9, 9, 23, 59), now)).toBe('overdue');
    });

    await it('calls up to three days ahead soon, later after that', async () => {
      expect(dueState(new Date(2026, 9, 11), now)).toBe('soon');
      expect(dueState(new Date(2026, 9, 13), now)).toBe('soon');
      expect(dueState(new Date(2026, 9, 14), now)).toBe('later');
    });

    await it('crosses a month end', async () => {
      expect(dueState(new Date(2026, 10, 1), new Date(2026, 9, 31, 23, 0))).toBe('soon');
    });
  });
};
