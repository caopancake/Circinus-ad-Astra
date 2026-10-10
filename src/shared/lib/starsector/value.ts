import type { JsonValue } from '@/shared/types';

export function deepClone<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => deepClone(item)) as T;
  }
  if (value && typeof value === 'object') {
    const clone: Record<string, unknown> = Object.create(null);
    for (const [key, item] of Object.entries(value)) {
      clone[key] = deepClone(item);
    }
    return clone as T;
  }
  return value;
}

export function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value) ?? '';
}

export function formatModVersion(value: JsonValue | undefined): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const major = value.major;
    const minor = value.minor;
    const patch = value.patch;
    if (typeof major === 'number' && typeof minor === 'number') {
      if (typeof patch === 'number') {
        return `${major}.${minor}.${patch}`;
      }
      return `${major}.${minor}`;
    }
  }
  return cell(value);
}

export function num(value: JsonValue | undefined, defaultValue = 0): number {
  const n = typeof value === 'number' ? value : parseFloat(cell(value));
  return Number.isFinite(n) ? n : defaultValue;
}

export function str(value: JsonValue | undefined, defaultValue = ''): string {
  const s = cell(value);
  return s || defaultValue;
}

export function arr(value: JsonValue | undefined, defaultValue: number[] = []): number[] {
  return Array.isArray(value) ? value.map((v) => num(v)) : [...defaultValue];
}
