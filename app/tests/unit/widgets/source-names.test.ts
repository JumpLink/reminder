import { describe, expect, it } from '@gjsify/unit';
import { duplicateNameIds } from '@gjsify/adwaita-extended/source-names';

export default async () => {
  await describe('duplicateNameIds', async () => {
    await it('is empty when every name is unique', async () => {
      expect(
        duplicateNameIds([
          { id: 'a', name: 'Home' },
          { id: 'b', name: 'Work' },
        ]).size,
      ).toBe(0);
      expect(duplicateNameIds([]).size).toBe(0);
    });

    await it('marks every row that shares a name, and only those', async () => {
      const ids = duplicateNameIds([
        { id: 'a', name: 'Personal' },
        { id: 'b', name: 'Birthdays' },
        { id: 'c', name: 'Personal' },
        { id: 'd', name: 'Personal' },
      ]);
      expect([...ids].sort().join(',')).toBe('a,c,d');
    });

    await it('ignores case and surrounding blanks', async () => {
      const ids = duplicateNameIds([
        { id: 'a', name: 'Chores' },
        { id: 'b', name: ' chores ' },
      ]);
      expect(ids.has('a')).toBe(true);
      expect(ids.has('b')).toBe(true);
    });
  });
};
