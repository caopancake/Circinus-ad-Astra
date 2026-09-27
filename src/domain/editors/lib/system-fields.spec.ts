import { describe, expect, it } from 'vitest';
import { SYSTEM_STRUCTURED_FIELD_KEYS, TYPE_EXCLUSIVE_FIELDS } from './system-fields';

describe('system field registries', () => {
  it('keeps every type-exclusive field inside the structured key set', () => {
    for (const [typeName, fields] of Object.entries(TYPE_EXCLUSIVE_FIELDS)) {
      for (const field of fields) {
        expect(SYSTEM_STRUCTURED_FIELD_KEYS.has(field), `${typeName}:${field}`).toBe(true);
      }
    }
  });

  it('declares exclusive fields for every special system type', () => {
    expect(Object.keys(TYPE_EXCLUSIVE_FIELDS)).toEqual([
      'ENGINE_MOD',
      'SHIELD_MOD',
      'PHASE_CLOAK',
      'DISPLACER',
      'WEAPON',
      'DRONE_LAUNCHER',
    ]);
    for (const fields of Object.values(TYPE_EXCLUSIVE_FIELDS)) {
      expect(fields.length).toBeGreaterThan(0);
    }
  });

  it('keeps the core structured keys every system spec shares', () => {
    for (const key of ['id', 'type', 'aiType', 'weaponTypes', 'aiHints', 'droneBehavior']) {
      expect(SYSTEM_STRUCTURED_FIELD_KEYS.has(key)).toBe(true);
    }
  });
});
