import { describe, expect, it } from 'vitest';
import { snapToStep, toOptions } from './editor-constants';

describe('snapToStep', () => {
  it('snaps to the default 0.5 step', () => {
    expect(snapToStep(3.2)).toBe(3);
    expect(snapToStep(3.4)).toBe(3.5);
    expect(snapToStep(3.6)).toBe(3.5);
    expect(snapToStep(-1.3)).toBe(-1.5);
    expect(snapToStep(0)).toBe(0);
  });

  it('snaps to the provided step', () => {
    expect(snapToStep(7, 2)).toBe(8);
    expect(snapToStep(6, 2)).toBe(6);
  });
});

describe('toOptions', () => {
  it('maps plain strings into label/value select options', () => {
    expect(toOptions(['A', 'B'])).toEqual([
      { label: 'A', value: 'A' },
      { label: 'B', value: 'B' },
    ]);
    expect(toOptions([])).toEqual([]);
  });
});
