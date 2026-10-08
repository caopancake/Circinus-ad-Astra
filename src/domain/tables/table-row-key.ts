import type { TableKey } from '@/shared/types';

export function createTableRowKey(table: TableKey, sequence: number): string {
  return `${table}:new:${sequence}`;
}
