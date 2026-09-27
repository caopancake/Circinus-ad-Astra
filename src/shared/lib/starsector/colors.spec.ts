import { describe, expect, it } from 'vitest';
import { rgba, SLOT_RADIUS, WEAPON_COLORS } from './colors';

describe('rgba', () => {
  it('renders an rgba string from an [r,g,b,a] color', () => {
    expect(rgba([10, 20, 30, 128])).toBe('rgba(10,20,30,0.502)');
  });

  it('multiplies the base alpha with the given alpha', () => {
    expect(rgba([255, 255, 255, 255], 0.5)).toBe('rgba(255,255,255,0.500)');
    expect(rgba([0, 0, 0, 0], 1)).toBe('rgba(0,0,0,0.000)');
  });

  it('falls back to opaque white for non-array colors', () => {
    expect(rgba(undefined)).toBe('rgba(255,255,255,1.000)');
    expect(rgba('broken')).toBe('rgba(255,255,255,1.000)');
  });
});

describe('weapon slot palettes', () => {
  it('defines a color for every slot type and a radius per size', () => {
    for (const type of [
      'BALLISTIC',
      'ENERGY',
      'MISSILE',
      'HYBRID',
      'UNIVERSAL',
      'LAUNCH_BAY',
      'SYNERGY',
      'COMPOSITE',
      'DECORATIVE',
      'SYSTEM',
      'STATION_MODULE',
    ]) {
      expect(WEAPON_COLORS[type as keyof typeof WEAPON_COLORS], type).toBeTruthy();
    }
    expect(SLOT_RADIUS).toEqual({ LARGE: 32, MEDIUM: 24, SMALL: 16 });
  });
});
