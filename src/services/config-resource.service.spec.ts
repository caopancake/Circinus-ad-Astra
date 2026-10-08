import { describe, expect, it, vi } from 'vitest';
import { queryBuiltInWeaponSlotOptions } from './config-resource.service';
import { mapSourceGroupsToSelectOptions } from '@/domain/schema/schema-options';

vi.mock('@/services/query.service', () => ({
  querySessionHullReferences: vi.fn(async () => ({
    builtInWeaponSlots: {
      hull: [
        { id: 'CORE', origin: 'core' },
        { id: 'MOD', origin: 'mod' },
      ],
    },
  })),
}));
vi.mock('@/services/resource-cache.service', () => ({ queryResourceDataUrls: vi.fn(async () => []) }));

describe('built-in slot origins', () => {
  it('preserves the backend origin through option grouping and labels', async () => {
    const groups = await queryBuiltInWeaponSlotOptions('s1', 'hull');
    expect(groups.map((group) => [group.origin, group.options[0]?.value])).toEqual([
      ['mod', 'MOD'],
      ['core', 'CORE'],
    ]);
    const options = mapSourceGroupsToSelectOptions(groups);
    expect(options[0]?.label).toBe('当前 Mod');
    expect(options[1]?.label).toBe('原版');
  });
});
