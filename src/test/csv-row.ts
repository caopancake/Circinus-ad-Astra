import type { CsvDraftRow, RowData } from '@/shared/types';
import { deepClone } from '@/shared/lib/starsector';

export function csvDraftRow(content: RowData, rowKey: string, sourceRowIndex: number | null = null, isComment = false): CsvDraftRow {
  return { data: deepClone(content), isComment, rowKey, sourceRowIndex, factionId: null, insertAt: null };
}
