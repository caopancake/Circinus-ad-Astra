import type { RowData } from '@/shared/types/json.types';
import type { ProjectSessionId } from '@/shared/types/query.types';
import type { ResourceRef } from '@/shared/types/query.types';

export const TABLE_KEYS = [
  'ships',
  'weapons',
  'wings',
  'hullmods',
  'shipSystems',
  'industries',
  'skills',
  'abilities',
  'commodities',
  'specialItems',
  'submarkets',
  'marketConditions',
  'simOpponents',
  'descriptions',
] as const;

export type TableKey = (typeof TABLE_KEYS)[number];

export interface CsvTableTarget {
  sessionId: string;
  modRoot: string;
  table: TableKey;
}

export interface CsvCellTarget extends CsvTableTarget {
  rowKey: string;
  column: string;
}

export const CSV_DEFAULT_FACTION_ID = 'other';
export const CSV_FACTION_FILTER_ALL = 'all';

export type CsvFactionFilter = { kind: 'all' } | { kind: 'faction'; factionId: string };

export type CsvDirtyRow = { action: 'upsert'; cells: Record<string, string> } | { action: 'delete' };

export interface CsvRowRecord {
  rowKey: string;
  data: RowData;
  factionId: string | null;
}

export interface CsvDraftRow extends CsvRowRecord {
  sourceRowIndex: number | null;
  insertAt: number | null;
}

export type CsvTableRows = Array<CsvDraftRow | null>;

export interface CsvTableWindow {
  baseVersions: import('@/shared/types/write.types').FileVersion[];
  table: TableKey;
  header: string[];
  totalRows: number;
  filteredRows: number;
  start: number;
  rows: CsvWindowRow[];
}

export interface CsvWindowRow extends CsvRowRecord {
  sourceRowIndex: number;
}

export interface CsvPlaceholderRowSlot {
  kind: 'placeholder';
  rowIndex: number;
  slotKey: string;
}

export interface CsvLoadedRowSlot extends CsvDraftRow {
  kind: 'row';
  rowIndex: number;
}

export type CsvGridRowSlot = CsvLoadedRowSlot | CsvPlaceholderRowSlot;

export interface CsvRowPreview {
  resourceRef: ResourceRef | null;
}

export interface CsvRowPreviewTarget {
  rowKey: string;
  sessionId: ProjectSessionId;
  table: TableKey;
}
