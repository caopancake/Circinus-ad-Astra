import { describe, expect, it } from 'vitest';
import { cell, deepClone, formatModVersion, num } from './value';

describe('formatModVersion', () => {
  it('formats a full three-part version object', () => {
    expect(formatModVersion({ major: 1, minor: 2, patch: 3 })).toBe('1.2.3');
  });

  it('formats a two-part version object without inventing a patch segment', () => {
    expect(formatModVersion({ major: 1, minor: 2 })).toBe('1.2');
  });

  it('keeps string versions verbatim', () => {
    expect(formatModVersion('0.97a-RC1')).toBe('0.97a-RC1');
  });

  it('serializes malformed version objects instead of crashing', () => {
    expect(formatModVersion({ major: 'one', minor: 2 })).toBe('{"major":"one","minor":2}');
    expect(formatModVersion({ major: 1 })).toBe('{"major":1}');
  });

  it('returns an empty string for absent values', () => {
    expect(formatModVersion(undefined)).toBe('');
  });
});

describe('cell', () => {
  it('renders primitives and serializes the rest', () => {
    expect(cell('text')).toBe('text');
    expect(cell(42)).toBe('42');
    expect(cell(true)).toBe('true');
    expect(cell(null)).toBe('');
    expect(cell({ a: 1 })).toBe('{"a":1}');
  });
});

describe('deepClone', () => {
  it('clones nested structures without aliasing', () => {
    const source = { list: [{ n: 1 }], flag: true, nil: null };
    const cloned = deepClone(source);
    cloned.list[0]!.n = 99;
    expect(source.list[0]!.n).toBe(1);
    expect(cloned).toEqual({ list: [{ n: 99 }], flag: true, nil: null });
  });
});

describe('num', () => {
  it('parses finite numbers and falls back on garbage', () => {
    expect(num(5)).toBe(5);
    expect(num('3.5')).toBe(3.5);
    expect(num('abc', 7)).toBe(7);
    expect(num(undefined, 2)).toBe(2);
  });
});
