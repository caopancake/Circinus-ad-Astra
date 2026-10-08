import type { CsvGridRowSlot, CsvLoadedRowSlot, CsvTableRows, TableKey } from '@/shared/types';
import { cell } from '@/shared/lib/starsector';
import { csvColumnSchemaFor, csvListValues } from '@/domain/tables/csv-column-schema';
import type { CsvColumnSchema } from '@/domain/schema/schema.types';
import { createCsvSourceIndex, sourceOptions, type CsvSourceIndex } from '@/domain/tables/csv-source-options';
import { flattenSelectOptions, type SelectOption } from '@/domain/schema/schema-options';

export interface CsvGridColumn {
  className: string;
  enumOptions: SelectOption[];
  key: string;
  schema: CsvColumnSchema | null;
  widthPx: number;
}

export interface CsvGridModel {
  columns: CsvGridColumn[];
  performanceSample: CsvGridPerformanceSample;
  rows: CsvGridRowSlot[];
  sourceIndex: CsvSourceIndex;
  totalWidthPx: number;
}

export interface CsvGridPerformanceSample {
  columns: number;
  ms: number;
  rows: number;
  sourceMs: number;
  table: TableKey;
  widthMs: number;
}

export function createCsvGridModel(
  table: TableKey,
  visibleColumns: string[],
  rowSlots: CsvTableRows,
  rowCount: number,
  loadedSourceOptions: Map<string, SelectOption[]> = new Map(),
): CsvGridModel {
  const startedAt = performance.now();
  const columns = visibleColumns.map((key) => createCsvGridColumn(table, key));
  const rows = createCsvGridRowSlots(table, rowSlots, rowCount);
  const loadedRows = rows.filter((row): row is CsvLoadedRowSlot => row.kind === 'row');
  const sourceStartedAt = performance.now();
  const sourceIndex = createCsvSourceIndex(
    columns.map((column) => column.schema?.source),
    loadedSourceOptions,
  );
  const sourceMs = performance.now() - sourceStartedAt;
  const widthStartedAt = performance.now();
  for (const column of columns) {
    column.widthPx = columnWidthPx(column, loadedRows, sourceIndex);
  }
  const widthMs = performance.now() - widthStartedAt;
  const totalWidthPx = columns.reduce((sum, column) => sum + column.widthPx, 0);
  const performanceSample = {
    columns: columns.length,
    ms: Math.round(performance.now() - startedAt),
    rows: rows.length,
    sourceMs: Math.round(sourceMs),
    table,
    widthMs: Math.round(widthMs),
  };
  return { columns, performanceSample, rows, sourceIndex, totalWidthPx };
}

function createCsvGridRowSlots(table: TableKey, rowSlots: CsvTableRows, rowCount: number): CsvGridRowSlot[] {
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const row = rowSlots[rowIndex];
    if (row) return { ...row, kind: 'row', rowIndex };
    return { kind: 'placeholder', rowIndex, slotKey: `${table}:slot:${rowIndex}` };
  });
}

function createCsvGridColumn(table: TableKey, key: string): CsvGridColumn {
  const schema = csvColumnSchemaFor(table, key);
  return {
    className: `schema-col-${schema?.control ?? 'text'}`,
    enumOptions: (schema?.options ?? []).map((option) => ({ label: option, value: option })),
    key,
    schema,
    widthPx: 0,
  };
}

function columnWidthPx(column: CsvGridColumn, rows: CsvLoadedRowSlot[], sourceIndex: CsvSourceIndex): number {
  const headerText = column.schema?.label ?? column.key;
  const headerWidth = textWidthPx(headerText, 'header');
  const control = column.schema?.control ?? 'text';
  const contentWidth = maxColumnContentWidthPx(column.key, rows);

  if (control === 'number') return clamp(Math.max(headerWidth, contentWidth) + 24, 48, 140);
  if (control === 'boolean') return clamp(Math.max(headerWidth, contentWidth, textWidthPx('false', 'cell')) + 30, 72, 120);
  if (control === 'enum') return clamp(Math.max(headerWidth, contentWidth, enumOptionsWidthPx(column.enumOptions)) + 44, 88, 240);
  if (control === 'reference')
    return clamp(
      Math.max(headerWidth, contentWidth, referenceOptionsWidthPx(sourceOptions(sourceIndex, column.schema?.source))) + 46,
      120,
      260,
    );
  if (control === 'tags' || control === 'multi') return clamp(Math.max(headerWidth + 42, tagColumnWidthPx(column.key, rows)) + 8, 160, 560);
  if (control === 'path-image') return clamp(Math.max(headerWidth, contentWidth * 0.6) + 24, 120, 220);
  if (control === 'color') return clamp(Math.max(headerWidth, contentWidth) + 24, 120, 220);
  return clamp(Math.max(headerWidth, contentWidth) + 24, 64, textColumnMaxPx(column.key));
}

function maxColumnContentWidthPx(key: string, rows: CsvLoadedRowSlot[]): number {
  let maxWidth = 0;
  for (const row of rows) {
    maxWidth = Math.max(maxWidth, textWidthPx(cell(row.data[key]), 'cell'));
  }
  return maxWidth;
}

function textColumnMaxPx(key: string): number {
  const normalized = key.toLowerCase();
  if (normalized.includes('id')) return 320;
  if (normalized.includes('path') || normalized.includes('sprite') || normalized.includes('icon')) return 260;
  if (normalized.includes('name')) return 260;
  return 220;
}

function tagColumnWidthPx(key: string, rows: CsvLoadedRowSlot[]): number {
  const rowWidths = rows
    .map((row) => tagRowWidthPx(cell(row.data[key])))
    .filter((width) => width > 0)
    .sort((a, b) => a - b);
  if (rowWidths.length === 0) return 160;
  const index = Math.min(rowWidths.length - 1, Math.floor(rowWidths.length * 0.9));
  return (rowWidths[index] ?? 160) + 20;
}

function tagRowWidthPx(value: string): number {
  const tags = csvListValues(value).slice(0, 6);
  if (tags.length === 0) return 0;
  const chipWidths = tags.map((tag) => clamp(textWidthPx(tag, 'cell') + 14, 32, 128));
  return chipWidths.reduce((sum, width) => sum + width, 0) + Math.max(0, chipWidths.length - 1) * 4;
}

function enumOptionsWidthPx(options: SelectOption[]): number {
  return longestLabelWidthPx(flattenOptionLabels(options));
}

function referenceOptionsWidthPx(options: SelectOption[]): number {
  return longestLabelWidthPx(flattenOptionLabels(options));
}

function flattenOptionLabels(options: SelectOption[]): string[] {
  return flattenSelectOptions(options).map((option) => option.label);
}

function longestLabelWidthPx(labels: string[]): number {
  let maxWidth = 0;
  for (const label of labels) maxWidth = Math.max(maxWidth, textWidthPx(label, 'cell'));
  return maxWidth;
}

function textWidthPx(value: string, kind: 'cell' | 'header'): number {
  const base = kind === 'header' ? 8.2 : 7.2;
  let width = 0;
  for (const char of value) {
    if (/[\u4e00-\u9fff]/u.test(char)) width += 12;
    else if (char === '_' || char === '-' || char === '/') width += 6.5;
    else if (char === ' ') width += 4;
    else width += base;
  }
  return Math.ceil(width);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.ceil(value)));
}
