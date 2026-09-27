import { describe, expect, it } from 'vitest';
import { normalizeProjectileSpec, normalizeShipSpec, normalizeSystemSpec, normalizeWeaponSpec } from './normalize';

describe('normalizeShipSpec', () => {
  it('fills missing collections with empty defaults', () => {
    const normalized = normalizeShipSpec({ hullId: 'XY' });
    expect(normalized.weaponSlots).toEqual([]);
    expect(normalized.engineSlots).toEqual([]);
    expect(normalized.bounds).toEqual([]);
    expect(normalized.builtInMods).toEqual([]);
    expect(normalized.builtInWings).toEqual([]);
    expect(normalized.builtInWeapons).toEqual({});
  });

  it('keeps existing collections untouched', () => {
    const normalized = normalizeShipSpec({ weaponSlots: [{ id: 'WS0' }], bounds: [1, 2], builtInWeapons: { ws: {} } });
    expect(normalized.weaponSlots).toEqual([{ id: 'WS0' }]);
    expect(normalized.bounds).toEqual([1, 2]);
    expect(normalized.builtInWeapons).toEqual({ ws: {} });
  });

  it('clones the input so later draft edits never alias the source', () => {
    const source = { weaponSlots: [{ id: 'WS0' }] };
    const normalized = normalizeShipSpec(source);
    (normalized.weaponSlots as unknown[]).push({ id: 'WS1' });
    expect(source.weaponSlots).toHaveLength(1);
  });
});

describe('normalizeWeaponSpec', () => {
  it('fills the four offset/angle arrays', () => {
    const normalized = normalizeWeaponSpec({});
    expect(normalized.turretOffsets).toEqual([]);
    expect(normalized.hardpointOffsets).toEqual([]);
    expect(normalized.turretAngleOffsets).toEqual([]);
    expect(normalized.hardpointAngleOffsets).toEqual([]);
  });

  it('keeps existing arrays', () => {
    const normalized = normalizeWeaponSpec({ turretOffsets: [10, 0], hardpointAngleOffsets: [0] });
    expect(normalized.turretOffsets).toEqual([10, 0]);
    expect(normalized.hardpointAngleOffsets).toEqual([0]);
    expect(normalized.turretAngleOffsets).toEqual([]);
  });
});

describe('normalizeProjectileSpec', () => {
  it('fills the engine slot array', () => {
    expect(normalizeProjectileSpec({}).engineSlots).toEqual([]);
    expect(normalizeProjectileSpec({ engineSlots: [{ angle: 0 }] }).engineSlots).toEqual([{ angle: 0 }]);
  });
});

describe('normalizeSystemSpec', () => {
  it('defaults the system type and structured collections', () => {
    const normalized = normalizeSystemSpec({});
    expect(normalized.type).toBe('STAT_MOD');
    expect(normalized.droneBehavior).toEqual([]);
    expect(normalized.aiHints).toEqual({});
    expect(normalized.weaponTypes).toEqual([]);
  });

  it('keeps an explicit system type and non-object aiHints replaced', () => {
    expect(normalizeSystemSpec({ type: 'PHASE_CLOAK' }).type).toBe('PHASE_CLOAK');
    expect(normalizeSystemSpec({ aiHints: 'broken' }).aiHints).toEqual({});
  });
});
