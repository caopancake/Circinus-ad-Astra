import { describe, expect, it } from 'vitest';
import { builtInWeaponSlotOptions } from './hull-references';
import { mapSourceGroupsToSelectOptions } from '@/domain/schema/schema-options';

describe('built-in slot origins', () => {
  it('preserves the backend origin through option grouping and labels', async () => {
    const groups = builtInWeaponSlotOptions(
      {
        groups: [],
        hullNames: {},
        sprites: {},
        builtInWeaponSlots: {
          hull: [
            { id: 'CORE', origin: 'core' },
            { id: 'MOD', origin: 'mod' },
          ],
        },
      },
      'hull',
    );
    expect(groups.map((group) => [group.origin, group.options[0]?.value])).toEqual([
      ['mod', 'MOD'],
      ['core', 'CORE'],
    ]);
    const options = mapSourceGroupsToSelectOptions(groups);
    expect(options[0]?.label).toBe('当前 Mod');
    expect(options[1]?.label).toBe('原版');
  });
});
