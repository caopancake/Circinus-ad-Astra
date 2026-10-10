import type { JsonInputShape, JsonInputValue, JsonValue } from '@/shared/types';

export type JsonInputParseResult<T> = { kind: 'value'; value: T } | { kind: 'error'; message: string };

export function parseJsonInput<T extends JsonInputShape>(raw: string, shape: T): JsonInputParseResult<JsonInputValue<T>> {
  let parsed: JsonValue;
  let nonFinite = false;
  try {
    parsed = JSON.parse(raw, (_key, value: unknown) => {
      if (typeof value === 'number' && !Number.isFinite(value)) nonFinite = true;
      return value;
    }) as JsonValue;
  } catch {
    return { kind: 'error', message: 'JSON 输入未完成，请修正后提交' };
  }
  if (nonFinite) return { kind: 'error', message: 'JSON 数值必须为有限数值' };
  if (shape === 'array' && !Array.isArray(parsed)) return { kind: 'error', message: '请输入 JSON 数组' };
  if (shape === 'object' && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)))
    return { kind: 'error', message: '请输入 JSON 对象' };
  return { kind: 'value', value: parsed as JsonInputValue<T> };
}

export function formatJsonInput(value: unknown, shape: JsonInputShape): string {
  const formatted = JSON.stringify(value ?? (shape === 'array' ? [] : {}), null, 2);
  return formatted === undefined ? '' : formatted;
}
