import type { CsvDirtyRow } from '@/shared/types';

export function createCsvDirtyCells(): CsvDirtyRow {
  const cells: Record<string, string> = Object.create(null);
  return { action: 'upsert', cells };
}

export function createCsvDeletedRow(): CsvDirtyRow {
  return { action: 'delete' };
}

export function isCsvDeletedRow(row: CsvDirtyRow | undefined): boolean {
  return row?.action === 'delete';
}

export function csvDirtyCells(row: CsvDirtyRow | undefined): Record<string, string> | null {
  return row?.action === 'upsert' ? row.cells : null;
}

export function hasCsvDirtyCells(row: CsvDirtyRow | undefined): boolean {
  const cells = csvDirtyCells(row);
  return cells !== null && Object.keys(cells).length > 0;
}
