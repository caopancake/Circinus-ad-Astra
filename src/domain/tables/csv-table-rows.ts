import type { CsvDraftRow } from '@/shared/types';

export function isLoadedCsvTableRow(row: CsvDraftRow | null | undefined): row is CsvDraftRow {
  return row !== null && row !== undefined;
}
