export const WEBVIEW_MEDIA_BUDGET_BYTES = 64 * 1024 * 1024;

interface BudgetEntry {
  bytes: number;
  onEvict: () => void;
}

const entries = new Map<string, BudgetEntry>();
let usedBytes = 0;

export function mediaBudgetBytes(value: string | null): number {
  return value === null ? 0 : new TextEncoder().encode(value).byteLength;
}

export function registerMediaBudgetEntry(key: string, bytes: number, onEvict: () => void): void {
  removeMediaBudgetEntry(key);
  entries.set(key, { bytes, onEvict });
  usedBytes += bytes;
  evictOverBudget();
}

export function touchMediaBudgetEntry(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  entries.delete(key);
  entries.set(key, entry);
}

export function removeMediaBudgetEntry(key: string): void {
  const entry = entries.get(key);
  if (!entry) return;
  entries.delete(key);
  usedBytes -= entry.bytes;
}

function evictOverBudget(): void {
  while (usedBytes > WEBVIEW_MEDIA_BUDGET_BYTES) {
    const oldestKey = entries.keys().next().value as string | undefined;
    if (oldestKey === undefined) return;
    const entry = entries.get(oldestKey);
    entries.delete(oldestKey);
    usedBytes -= entry?.bytes ?? 0;
    entry?.onEvict();
  }
}
