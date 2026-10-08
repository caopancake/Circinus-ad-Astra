import type { CsvDraftRow, RowData } from '@/shared/types';
import { deepClone } from '@/shared/lib/starsector';

export function csvDraftRow(content: RowData, rowKey: string, sourceRowIndex: number | null = null): CsvDraftRow {
  return { data: deepClone(content), rowKey, sourceRowIndex, factionId: null, insertAt: null };
}
