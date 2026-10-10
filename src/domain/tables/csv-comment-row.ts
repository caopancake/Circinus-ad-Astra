import type { CsvRow } from '@/shared/types';

export function isCsvCommentRow(row: CsvRow | null | undefined): boolean {
  return row?.isComment ?? false;
}
