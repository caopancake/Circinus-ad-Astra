import { describe, expect, it } from 'vitest';
import { applySchemaFieldUpdate, convertSchemaScalarInput, parseSchemaPlainNumber, schemaJsonInputShape } from './schema-values';

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

describe('schema scalar commit contract', () => {
  it('returns an explicit error for incomplete and unsafe numeric input', () => {
    const field = { key: 'count', label: '数量', type: 'integer' as const };
    expect(convertSchemaScalarInput('-', field)).toMatchObject({ kind: 'error' });
    expect(convertSchemaScalarInput('9007199254740992', field)).toMatchObject({ kind: 'error' });
    expect(convertSchemaScalarInput('12', field)).toEqual({ kind: 'set', value: 12 });
  });

  it('uses declared boolean spellings and range constraints', () => {
    expect(convertSchemaScalarInput('yes', { key: 'enabled', label: '启用', type: 'boolean' })).toEqual({ kind: 'set', value: true });
    expect(convertSchemaScalarInput('perhaps', { key: 'enabled', label: '启用', type: 'boolean' })).toMatchObject({ kind: 'error' });
    expect(convertSchemaScalarInput('5', { key: 'count', label: '数量', type: 'integer', max: 4 })).toMatchObject({ kind: 'error' });
  });

  it('removes optional keys, rejects required emptiness and keeps siblings', () => {
    const field = { key: 'count', label: '数量', type: 'integer' as const };
    expect(convertSchemaScalarInput('', field)).toEqual({ kind: 'remove' });
    expect(convertSchemaScalarInput('', { ...field, required: true })).toMatchObject({ kind: 'error' });
    const source = { nested: { count: 1, name: 'keep' }, other: 2 };
    expect(applySchemaFieldUpdate(source, 'nested.count', { kind: 'remove' })).toEqual({ nested: { name: 'keep' }, other: 2 });
    expect(source.nested.count).toBe(1);
  });
});

describe('declared JSON input shape', () => {
  it.each([
    [{ type: 'object' as const }, 'object'],
    [{ type: 'key-value' as const }, 'object'],
    [{ type: 'array' as const }, 'array'],
    [{ type: 'array-of-object' as const }, 'array'],
    [{ type: 'key-value' as const, format: 'array-of-entries' as const }, 'array'],
  ])('uses the field declaration instead of the current value', (field, shape) => {
    expect(schemaJsonInputShape(field)).toBe(shape);
  });
});
