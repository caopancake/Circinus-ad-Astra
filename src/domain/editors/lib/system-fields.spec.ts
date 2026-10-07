import { describe, expect, it } from 'vitest';
import { SYSTEM_STRUCTURED_FIELD_KEYS } from './system-fields';
import { SYSTEM_TYPES } from './game-spec-enums';

describe('system field registries', () => {
  it('offers every type accepted by the game system loader', () => {
    expect(SYSTEM_TYPES).toEqual([
      'WEAPON',
      'ENGINE_MOD',
      'SHIELD_MOD',
      'STAT_MOD',
      'FAST_RELOAD',
      'AMMO_RELOAD',
      'TELEPORTER',
      'PHASE_CLOAK',
      'DISPLACER',
      'DRONE_LAUNCHER',
      'EMP',
    ]);
  });

  it('keeps the core structured keys every system spec shares', () => {
    for (const key of ['id', 'type', 'aiType', 'weaponTypes', 'aiHints', 'droneBehavior']) {
      expect(SYSTEM_STRUCTURED_FIELD_KEYS.has(key)).toBe(true);
    }
  });
});
