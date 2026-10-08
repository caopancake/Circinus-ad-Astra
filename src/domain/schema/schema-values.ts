import type { RowData } from '@/shared/types';
import { pathBasename } from '@/shared/lib/paths';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import { parseInputNumber } from '@/shared/lib/input-number';

export interface SchemaKeyValueEntry {
  key: string;
  val: unknown;
}

const SCHEMA_TRUE_TEXT = new Set(['true', '1', 'yes', 'y', 'on']);
const SCHEMA_FALSE_TEXT = new Set(['false', '0', 'no', 'n', 'off']);

export function schemaStringValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function schemaArrayStringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export function schemaTagValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (isObjectWithSchemaTags(value)) {
    const tags = value.tags;
    return Array.isArray(tags) ? tags.map(String) : [];
  }
  return [];
}

export function wrapSchemaTagValues(currentValue: unknown, tags: string[]): unknown {
  if (isObjectWithSchemaTags(currentValue)) return { ...currentValue, tags };
  return tags;
}

export function schemaPlainBooleanText(value: unknown): string {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return schemaStringValue(value);
}

export function parseSchemaPlainBoolean(raw: string): boolean | string {
  const normalized = raw.trim().toLowerCase();
  if (SCHEMA_TRUE_TEXT.has(normalized)) return true;
  if (SCHEMA_FALSE_TEXT.has(normalized)) return false;
  return raw;
}

export function parseSchemaPlainNumber(raw: string, integer: boolean): number | string {
  return parseInputNumber(raw, integer);
}

export function convertSchemaScalarInput(raw: string, field: FieldSchema): SchemaFieldUpdate | { kind: 'error'; message: string } {
  if (raw.trim() === '') {
    return field.required ? { kind: 'error', message: '必填字段不能为空' } : { kind: 'remove' };
  }
  const value = field.type === 'boolean' ? parseSchemaPlainBoolean(raw) : parseSchemaPlainNumber(raw, field.type === 'integer');
  if (typeof value === 'string') return { kind: 'error', message: field.type === 'boolean' ? '请输入有效布尔值' : '请输入完整有效数字' };
  if (typeof value === 'number' && ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max))) {
    return { kind: 'error', message: '数值超出字段允许范围' };
  }
  return { kind: 'set', value };
}

export function applySchemaFieldUpdate(obj: RowData, key: string, update: SchemaFieldUpdate): RowData {
  if (update.kind === 'set') return setNestedValue(obj, key, update.value);
  const parts = key.split('.');
  const leaf = parts.pop()!;
  const result = { ...obj };
  let target: Record<string, unknown> = result;
  for (const part of parts) {
    const source = target[part];
    if (source === undefined) return result;
    target[part] = { ...(source as Record<string, unknown>) };
    target = target[part] as Record<string, unknown>;
  }
  delete target[leaf];
  return result;
}

export function schemaNumberControlValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseSchemaControlNumber(value: number | null, integer: boolean): number | string {
  if (value === null) return '';
  return integer ? Math.trunc(value) : value;
}

export function formatSchemaCommaList(values: string[]): string {
  return values.join(', ');
}

export function parseSchemaCommaList(raw: string): string[] {
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function schemaPathDisplayLabel(path: string): string {
  return pathBasename(path);
}

export function schemaKeyValueEntries(value: unknown, format: FieldSchema['format']): SchemaKeyValueEntry[] {
  if (format === 'array-of-entries' && Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const firstKey = Object.keys(item)[0];
        if (firstKey !== undefined) return { key: firstKey, val: (item as Record<string, unknown>)[firstKey] };
      }
      return { key: '', val: '' };
    });
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).map(([key, val]) => ({ key, val }));
  }
  return [];
}

export function schemaKeyValueOutput(
  entries: SchemaKeyValueEntry[],
  format: FieldSchema['format'],
): Record<string, unknown> | Record<string, unknown>[] {
  if (format === 'array-of-entries') return entries.filter((entry) => entry.key).map((entry) => ({ [entry.key]: entry.val }));

  const result: Record<string, unknown> = {};
  for (const entry of entries) {
    if (entry.key) result[entry.key] = schemaKeyValueObjectValue(entry.val);
  }
  return result;
}

export function appendSchemaKeyValueEntry(
  entries: SchemaKeyValueEntry[],
  format: FieldSchema['format'],
): Record<string, unknown> | Record<string, unknown>[] {
  return schemaKeyValueOutput([...entries, { key: nextSchemaKeyValueKey(entries, format), val: '' }], format);
}

export function parseSchemaKeyValueText(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  const numberValue = Number(trimmed);
  if (!Number.isNaN(numberValue)) return numberValue;
  return raw;
}

export function formatSchemaKeyValueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function parseSchemaUiJsonText(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return raw;
    }
  }
  return raw;
}

export function formatSchemaUiJsonText(value: unknown): string {
  if (value == null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function getNestedValue(obj: RowData, key: string): unknown {
  const parts = key.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setNestedValue(obj: RowData, key: string, value: unknown): RowData {
  const parts = key.split('.');
  const leaf = parts.pop() ?? '';
  if (parts.length === 0) {
    return { ...obj, [leaf]: value as RowData[string] };
  }
  const result = { ...obj };
  let target: Record<string, unknown> = result;
  for (const part of parts) {
    const next = target[part];
    target[part] = typeof next === 'object' && next !== null ? { ...(next as Record<string, unknown>) } : {};
    target = target[part] as Record<string, unknown>;
  }
  target[leaf] = value;
  return result;
}

function isObjectWithSchemaTags(value: unknown): value is Record<string, unknown> & { tags: unknown } {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'tags' in value);
}

function schemaKeyValueObjectValue(value: unknown): unknown {
  if (typeof value === 'object' && value !== null) return value;
  const text = String(value);
  const numberValue = Number(text);
  return !isNaN(numberValue) && text.trim() !== '' ? numberValue : value;
}

function nextSchemaKeyValueKey(entries: SchemaKeyValueEntry[], format: FieldSchema['format']): string {
  const base = format === 'array-of-entries' ? 'newEntry' : 'newField';
  const existingKeys = new Set(entries.map((entry) => entry.key));
  if (!existingKeys.has(base)) return base;
  let index = 1;
  while (existingKeys.has(`${base}${index}`)) index += 1;
  return `${base}${index}`;
}
