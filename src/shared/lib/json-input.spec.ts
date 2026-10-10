import { describe, expect, it } from 'vitest';
import { formatJsonInput, parseJsonInput } from './json-input';

describe('json input semantics', () => {
  it.each(['1e309', '{"value":1e309}', '[{"value":-1e309}]'])('rejects overflowing numbers in %s before wire serialization', (raw) => {
    expect(parseJsonInput(raw, 'json')).toEqual({ kind: 'error', message: 'JSON 数值必须为有限数值' });
    expect(parseJsonInput(raw.replaceAll('309', '308'), 'json').kind).toBe('value');
  });
  it.each([
    ['object', '{"id":"demo"}', { id: 'demo' }],
    ['array', '[1,null,"demo"]', [1, null, 'demo']],
    ['json', 'null', null],
    ['json', 'true', true],
  ] as const)('parses %s values without changing business keys', (shape, raw, value) => {
    expect(parseJsonInput(raw, shape)).toEqual({ kind: 'value', value });
  });

  it.each([
    ['object', '[]', '请输入 JSON 对象'],
    ['array', '{}', '请输入 JSON 数组'],
    ['json', '{"id":', 'JSON 输入未完成，请修正后提交'],
  ] as const)('reports the declared shape error for %s', (shape, raw, message) => {
    expect(parseJsonInput(raw, shape)).toEqual({ kind: 'error', message });
  });

  it('formats object and array defaults at the input boundary', () => {
    expect(formatJsonInput(undefined, 'object')).toBe('{}');
    expect(formatJsonInput(undefined, 'array')).toBe('[]');
    expect(formatJsonInput({ nested: [1, 2] }, 'object')).toBe(`{
  "nested": [
    1,
    2
  ]
}`);
  });
});
