import type { RowData } from '@/shared/types';

export function extraJsonFieldKeys(content: RowData, knownKeys: readonly string[]): string[] {
  return Object.keys(content).filter((key) => !knownKeys.includes(key));
}
