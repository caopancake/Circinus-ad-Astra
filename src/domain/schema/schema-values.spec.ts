import { describe, expect, it } from 'vitest';
import { parseSchemaPlainNumber } from './schema-values';

describe('whole-value plain numbers', () => {
  it.each(['12foo', '1e3', '1.5', '9007199254740992', '0x10'])('preserves integer input %s', (raw) => {
    expect(parseSchemaPlainNumber(raw, true)).toBe(raw);
  });
  it.each([
    ['+12', 12],
    ['-12', -12],
    [' 12 ', 12],
  ] as const)('parses complete integer %s', (raw, expected) => {
    expect(parseSchemaPlainNumber(raw, true)).toBe(expected);
  });
  it('accepts finite decimal floating values and preserves incomplete ones', () => {
    expect(parseSchemaPlainNumber('1e3', false)).toBe(1000);
    expect(parseSchemaPlainNumber('12foo', false)).toBe('12foo');
    expect(parseSchemaPlainNumber('Infinity', false)).toBe('Infinity');
  });
});
