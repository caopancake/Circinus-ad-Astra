import type { CsvDraftRow, TableKey } from '@/shared/types/tables.types';

export interface CsvCellValueSetOperation {
  type: 'cell-value-set';
  tab: TableKey;
  rowKey: string;
  col: string;
  previousValue: string;
  newValue: string;
  previousIsComment: boolean;
  newIsComment: boolean;
}

export interface CsvRowCreatedOperation {
  type: 'row-created';
  tab: TableKey;
  rowKey: string;
  rowIndex: number;
  row: CsvDraftRow;
}

export interface CsvRowDeletedOperation {
  type: 'row-deleted';
  tab: TableKey;
  rowKey: string;
  rowIndex: number;
  row: CsvDraftRow;
}

export type CsvDraftOperation = CsvCellValueSetOperation | CsvRowCreatedOperation | CsvRowDeletedOperation;

export interface CsvEditHistoryEntry {
  id: string;
  timestamp: number;
  operation: CsvDraftOperation;
  label: string;
}
