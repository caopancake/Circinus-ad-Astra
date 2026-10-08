import type { CsvDraftOperation, CsvRowKeyMapping, CsvRowPatch, CsvTableWindow, ModTableState, RowData, TableKey } from '@/shared/types';
import { CSV_FACTION_FIELD } from '@/shared/types';
import { cell, deepClone, rowDisplayId } from '@/shared/lib/starsector';
import { isInternalJsonFieldKey } from '@/shared/lib/json-fields';
import { createCsvDeletedRow, createCsvDirtyCells, csvDirtyCells, hasCsvDirtyCells } from '@/domain/tables/csv-dirty';
import { defaultCsvFactionId } from '@/domain/tables/csv-faction-filter';
import { isLoadedCsvTableRow } from '@/domain/tables/csv-table-rows';
import { resolveTableRowKey, TABLE_ROW_KEY_FIELD } from '@/domain/tables/table-row-key';

export interface CsvDraftResult {
  changed: boolean;
  externalUpdateMarked?: boolean;
  historyLabel?: string;
  historyOperation?: CsvDraftOperation;
}

export interface CsvRowTarget {
  rowKey: string;
  rowIndex: number;
}

/// Row identity of a row-created/row-deleted draft result, for log records.
export function csvRowTargetOf(result: CsvDraftResult): CsvRowTarget | null {
  const operation = result.historyOperation;
  if (!operation || (operation.type !== 'row-created' && operation.type !== 'row-deleted')) return null;
  return { rowKey: operation.rowKey, rowIndex: operation.rowIndex };
}

export function applyCsvTableWindowDraft(state: ModTableState, window: CsvTableWindow): CsvDraftResult {
  const table = window.table;
  if (hasCsvTableDraftChanges(state, table)) {
    state.pendingExternalTableUpdates[table] = true;
    return { changed: false, externalUpdateMarked: true };
  }
  state.headers[table] = [...window.header];
  state.baseVersions[table] = window.baseVersions;
  state.totalRows[table] = window.totalRows;
  state.filteredRows[table] = window.filteredRows;
  const rows = window.rows.map((item) => ({
    ...deepClone(item.row),
    [TABLE_ROW_KEY_FIELD]: item.rowKey,
    _sourceRowIndex: item.rowIndex,
  }));
  state.tables[table] = mergeWindowRows(state.tables[table], rows, window.start, window.filteredRows);
  state.originalTables[table] = mergeWindowRows(state.originalTables[table], deepClone(rows), window.start, window.filteredRows);
  return { changed: true };
}

export function hasCsvTableDraftChanges(state: ModTableState, table: TableKey): boolean {
  return Object.keys(state.dirty[table]).length > 0 || state.editing?.tab === table;
}

export function markCsvTableExternalUpdateDraft(state: ModTableState, table: TableKey): void {
  state.pendingExternalTableUpdates[table] = true;
}

export function clearCsvTableExternalUpdateDraft(state: ModTableState, table: TableKey): void {
  state.pendingExternalTableUpdates[table] = false;
}

export function startCsvCellEditDraft(state: ModTableState, rowKey: string, col: string, value: string): void {
  state.editing = { tab: state.currentTab, rowKey, col, value };
}

export function setCsvEditingValueDraft(state: ModTableState, value: string): void {
  if (state.editing) state.editing.value = value;
}

export function cancelCsvCellEditDraft(state: ModTableState): void {
  state.editing = null;
}

export function finishCsvCellEditDraft(state: ModTableState): CsvDraftResult {
  if (!state.editing) return { changed: false };
  const { tab, rowKey, col, value } = state.editing;
  state.editing = null;
  return setCsvCellValueDraft(state, tab, rowKey, col, value);
}

export function setCsvCellValueDraft(state: ModTableState, tab: TableKey, rowKey: string, col: string, value: string): CsvDraftResult {
  const row = findLoadedRow(state, tab, rowKey);
  if (!row) return { changed: false };
  const previousValue = cell(row[col]);
  row[col] = value;
  refreshCsvCellDirty(state, tab, rowKey, col, value);
  if (value === previousValue) return { changed: true };
  return {
    changed: true,
    historyLabel: `编辑 ${tab} [${col}]`,
    historyOperation: { type: 'cell-value-set', tab, rowKey, col, previousValue, newValue: value },
  };
}

export function createCsvRowDraft(state: ModTableState, now: number): CsvDraftResult {
  const tab = state.currentTab;
  const id = `new_${tab}_${now}`;
  const row: RowData = {};
  for (const col of state.headers[tab]) row[col] = '';
  if ('id' in row) row.id = id;
  if ('name' in row) row.name = id;
  row[CSV_FACTION_FIELD] = defaultCsvFactionId();
  row[TABLE_ROW_KEY_FIELD] = `${tab}:new:${state.nextRowKey++}`;

  state.tables[tab].push(row);
  adjustCsvTableRowCounts(state, tab, 1);
  const rowIndex = state.tables[tab].length - 1;
  const rowKey = csvTableRowKey(tab, row, rowIndex);
  state.selectedRowKey = rowKey;
  markCsvRowDirty(state, tab, rowKey, row);
  return {
    changed: true,
    historyLabel: `新建 ${tab} 行: ${id}`,
    historyOperation: { type: 'row-created', tab, rowKey, rowIndex, row: deepClone(row) },
  };
}

export function deleteSelectedCsvRowDraft(state: ModTableState): CsvDraftResult {
  const tab = state.currentTab;
  const rowKey = state.selectedRowKey;
  if (!rowKey) return { changed: false };
  const rowIndex = findLoadedRowIndex(state, tab, rowKey);
  if (rowIndex < 0) {
    state.selectedRowKey = null;
    return { changed: false };
  }
  const row = state.tables[tab][rowIndex];
  if (!isLoadedCsvTableRow(row)) return { changed: false };
  const id = rowDisplayId(row) || `第 ${rowIndex + 1} 行`;
  state.tables[tab] = state.tables[tab].filter((candidate) => candidate !== row);
  adjustCsvTableRowCounts(state, tab, -1);
  markCsvRowDeleted(state, tab, rowKey);
  state.selectedRowKey = null;
  return {
    changed: true,
    historyLabel: `删除 ${tab} 行: ${id}`,
    historyOperation: { type: 'row-deleted', tab, rowKey, rowIndex, row: deepClone(row) },
  };
}

export function applyCsvDraftOperation(
  state: ModTableState | undefined,
  operation: CsvDraftOperation,
  direction: 'undo' | 'redo',
): boolean {
  if (!state) return false;
  if (operation.type === 'cell-value-set') {
    return setCsvCellValueForReplay(
      state,
      operation.tab,
      operation.rowKey,
      operation.col,
      direction === 'undo' ? operation.previousValue : operation.newValue,
    );
  }
  if (operation.type === 'row-created') {
    return direction === 'undo'
      ? removeCsvRowForReplay(state, operation.tab, operation.rowKey)
      : insertCsvRowForReplay(state, operation.tab, operation.rowIndex, operation.rowKey, operation.row);
  }
  return direction === 'undo'
    ? insertCsvRowForReplay(state, operation.tab, operation.rowIndex, operation.rowKey, operation.row)
    : removeCsvRowForReplay(state, operation.tab, operation.rowKey);
}

export function discardCsvTableWindowDraft(state: ModTableState, tab: TableKey): void {
  state.tables[tab] = [];
  state.originalTables[tab] = [];
  state.dirty[tab] = {};
  if (state.currentTab === tab) {
    state.selectedRowKey = null;
    state.editing = null;
  }
}

export function discardCsvTableWindowForReloadDraft(state: ModTableState, tab: TableKey): void {
  discardCsvTableWindowDraft(state, tab);
  state.pendingExternalTableUpdates[tab] = false;
}

export function markCsvTableSavedDraft(state: ModTableState, tab: TableKey): void {
  state.originalTables[tab] = deepClone(state.tables[tab]);
  state.dirty[tab] = {};
  state.pendingExternalTableUpdates[tab] = false;
}

export function commitCsvTableSaveDraft(state: ModTableState, tab: TableKey, patches: CsvRowPatch[], keyMap: CsvRowKeyMapping[]): void {
  const removedPositions = patches
    .filter((patch) => patch.action === 'delete')
    .flatMap((patch) => {
      const row = findOriginalRow(state, tab, patch.rowKey);
      return typeof row?._sourceRowIndex === 'number' ? [row._sourceRowIndex] : [];
    });
  const restoredPositions = patches
    .filter((patch) => patch.action === 'delete')
    .flatMap((patch) => {
      const row = findLoadedRow(state, tab, patch.rowKey);
      return typeof row?._sourceRowIndex === 'number' ? [row._sourceRowIndex] : [];
    });
  const insertedKeys = new Set(keyMap.map((mapping) => mapping.nextKey));
  const insertedPositions = keyMap.map((mapping) => mapping.rowIndex).sort((left, right) => left - right);
  applySavedCsvRowKeyMapDraft(state, tab, keyMap);
  const original = state.originalTables[tab];
  const mapped = new Map(keyMap.map((item) => [item.previousKey, item.nextKey]));
  for (const patch of patches) {
    const rowKey = mapped.get(patch.rowKey) ?? patch.rowKey;
    const index = original.findIndex(
      (candidate, rowIndex) => isLoadedCsvTableRow(candidate) && csvTableRowKey(tab, candidate, rowIndex) === rowKey,
    );
    if (patch.action === 'delete') {
      if (index >= 0) original.splice(index, 1);
      const restored = findLoadedRow(state, tab, rowKey);
      if (restored) {
        const previousKey = rowKey;
        const nextKey = `${tab}:new:${state.nextRowKey++}`;
        const sourceIndex = typeof restored._sourceRowIndex === 'number' ? restored._sourceRowIndex : 0;
        const rowIndex =
          sourceIndex -
          removedPositions.filter((position) => position < sourceIndex).length +
          restoredPositions.filter((position) => position < sourceIndex).length;
        restored._insertAt = rowIndex;
        const mapping = { previousKey, nextKey, rowIndex };
        keyMap.push(mapping);
        applySavedCsvRowKeyMapDraft(state, tab, [mapping]);
      }
      continue;
    }
    const sourceIndex =
      keyMap.find((mapping) => mapping.nextKey === rowKey)?.rowIndex ?? (index >= 0 ? original[index]?._sourceRowIndex : undefined);
    const savedRow = {
      ...deepClone(patch.row),
      [TABLE_ROW_KEY_FIELD]: rowKey,
      ...(typeof sourceIndex === 'number' ? { _sourceRowIndex: sourceIndex } : {}),
    };
    if (index >= 0) original[index] = savedRow;
    else original.push(savedRow);
  }
  for (const row of [...state.tables[tab], ...state.originalTables[tab]]) {
    if (!row || typeof row._sourceRowIndex !== 'number' || insertedKeys.has(cell(row[TABLE_ROW_KEY_FIELD]))) continue;
    row._sourceRowIndex -= removedPositions.filter((position) => position < (row._sourceRowIndex as number)).length;
    for (const position of insertedPositions) {
      if (row._sourceRowIndex >= position) row._sourceRowIndex++;
    }
  }
  rebuildCsvDirty(state, tab);
  state.pendingExternalTableUpdates[tab] = hasCsvTableDraftChanges(state, tab);
}

export function replaceCsvTableDraft(state: ModTableState, tab: TableKey, rows: RowData[]): void {
  state.tables[tab] = deepClone(rows);
  state.originalTables[tab] = deepClone(state.tables[tab]);
  state.dirty[tab] = {};
  state.pendingExternalTableUpdates[tab] = false;
}

export function applySavedCsvRowKeyMapDraft(state: ModTableState, tab: TableKey, keyMap: CsvRowKeyMapping[]): void {
  if (keyMap.length === 0) return;
  const mapped = new Map(keyMap.map((item) => [item.previousKey, item.nextKey]));
  for (const row of state.tables[tab]) applySavedRowKey(row, mapped);
  for (const row of state.originalTables[tab]) applySavedRowKey(row, mapped);
  for (const row of state.tables[tab]) {
    if (!row) continue;
    const mapping = keyMap.find((mapping) => mapping.nextKey === cell(row[TABLE_ROW_KEY_FIELD]));
    if (mapping && !mapping.nextKey.includes(':new:')) {
      row._sourceRowIndex = mapping.rowIndex;
      delete row._insertAt;
    }
  }
  if (state.selectedRowKey) {
    state.selectedRowKey = mapped.get(state.selectedRowKey) ?? state.selectedRowKey;
  }
  if (state.editing?.tab === tab) {
    state.editing.rowKey = mapped.get(state.editing.rowKey) ?? state.editing.rowKey;
  }
}

export function csvTableRowKey(tab: TableKey, row: RowData, index: number): string {
  return resolveTableRowKey(tab, row, index);
}

function setCsvCellValueForReplay(state: ModTableState, tab: TableKey, rowKey: string, col: string, value: string): boolean {
  const row = findLoadedRow(state, tab, rowKey);
  if (!row) return false;
  row[col] = value;
  refreshCsvCellDirty(state, tab, rowKey, col, value);
  return true;
}

function insertCsvRowForReplay(state: ModTableState, tab: TableKey, rowIndex: number, rowKey: string, row: RowData): boolean {
  if (state.tables[tab].some((candidate, index) => isLoadedCsvTableRow(candidate) && csvTableRowKey(tab, candidate, index) === rowKey))
    return true;
  const next = deepClone(row);
  next[TABLE_ROW_KEY_FIELD] = rowKey;
  state.tables[tab].splice(Math.max(0, Math.min(rowIndex, state.tables[tab].length)), 0, next);
  adjustCsvTableRowCounts(state, tab, 1);
  markCsvRowDirty(state, tab, rowKey, next);
  return true;
}

function removeCsvRowForReplay(state: ModTableState, tab: TableKey, rowKey: string): boolean {
  const index = findLoadedRowIndex(state, tab, rowKey);
  if (index < 0) return false;
  state.tables[tab].splice(index, 1);
  adjustCsvTableRowCounts(state, tab, -1);
  markCsvRowDeleted(state, tab, rowKey);
  if (state.selectedRowKey === rowKey) state.selectedRowKey = null;
  if (state.editing?.tab === tab && state.editing.rowKey === rowKey) state.editing = null;
  return true;
}

function adjustCsvTableRowCounts(state: ModTableState, tab: TableKey, delta: number): void {
  state.totalRows[tab] = Math.max(0, state.totalRows[tab] + delta);
  state.filteredRows[tab] = Math.max(0, state.filteredRows[tab] + delta);
}

function refreshCsvCellDirty(state: ModTableState, tab: TableKey, rowKey: string, col: string, value: string): void {
  const original = findOriginalRow(state, tab, rowKey);
  const originalValue = cell(original?.[col]);
  if (value !== originalValue) {
    ensureCsvDirtyCells(state, tab, rowKey)[col] = value;
    return;
  }
  const cells = csvDirtyCells(state.dirty[tab][rowKey]);
  if (!cells) return;
  delete cells[col];
  if (!hasCsvDirtyCells(state.dirty[tab][rowKey])) delete state.dirty[tab][rowKey];
}

function rebuildCsvDirty(state: ModTableState, tab: TableKey): void {
  state.dirty[tab] = {};
  const dirty = state.dirty[tab];
  const originalByKey = new Map(
    state.originalTables[tab].flatMap((row, index) => (isLoadedCsvTableRow(row) ? [[csvTableRowKey(tab, row, index), row] as const] : [])),
  );
  const currentKeys = new Set<string>();
  for (const row of state.tables[tab]) {
    if (!isLoadedCsvTableRow(row)) continue;
    const rowKey = cell(row[TABLE_ROW_KEY_FIELD]);
    currentKeys.add(rowKey);
    const original = originalByKey.get(rowKey);
    for (const [key, value] of Object.entries(row)) {
      if (isInternalJsonFieldKey(key)) continue;
      if (!original || cell(value) !== cell(original[key])) {
        ensureCsvDirtyCells(state, tab, rowKey)[key] = cell(value);
      }
    }
    if (!original && !dirty[rowKey]) dirty[rowKey] = createCsvDirtyCells();
  }
  for (const rowKey of originalByKey.keys()) {
    if (!currentKeys.has(rowKey)) dirty[rowKey] = createCsvDeletedRow();
  }
}

function markCsvRowDirty(state: ModTableState, tab: TableKey, rowKey: string, row: RowData): void {
  const original = findOriginalRow(state, tab, rowKey);
  delete state.dirty[tab][rowKey];
  if (!original) {
    state.dirty[tab][rowKey] = createCsvDirtyCells();
    const cells = csvDirtyCells(state.dirty[tab][rowKey]);
    if (!cells) return;
    for (const [key, value] of Object.entries(row)) {
      if (!isInternalJsonFieldKey(key)) cells[key] = cell(value);
    }
    return;
  }
  for (const [key, value] of Object.entries(row)) {
    if (isInternalJsonFieldKey(key)) continue;
    const next = cell(value);
    const prev = cell(original[key]);
    if (next !== prev) ensureCsvDirtyCells(state, tab, rowKey)[key] = next;
  }
}

function markCsvRowDeleted(state: ModTableState, tab: TableKey, rowKey: string): void {
  const originalExists = Boolean(findOriginalRow(state, tab, rowKey));
  if (originalExists) state.dirty[tab][rowKey] = createCsvDeletedRow();
  else delete state.dirty[tab][rowKey];
}

function ensureCsvDirtyCells(state: ModTableState, tab: TableKey, rowKey: string): Record<string, string> {
  const existingCells = csvDirtyCells(state.dirty[tab][rowKey]);
  if (existingCells) return existingCells;
  state.dirty[tab][rowKey] = createCsvDirtyCells();
  return csvDirtyCells(state.dirty[tab][rowKey]) ?? {};
}

function findLoadedRow(state: ModTableState, tab: TableKey, rowKey: string): RowData | null {
  return (
    state.tables[tab].find(
      (candidate, index): candidate is RowData => isLoadedCsvTableRow(candidate) && csvTableRowKey(tab, candidate, index) === rowKey,
    ) ?? null
  );
}

function findOriginalRow(state: ModTableState, tab: TableKey, rowKey: string): RowData | null {
  return (
    state.originalTables[tab].find(
      (candidate, index): candidate is RowData => isLoadedCsvTableRow(candidate) && csvTableRowKey(tab, candidate, index) === rowKey,
    ) ?? null
  );
}

function findLoadedRowIndex(state: ModTableState, tab: TableKey, rowKey: string): number {
  return state.tables[tab].findIndex(
    (candidate, index) => isLoadedCsvTableRow(candidate) && csvTableRowKey(tab, candidate, index) === rowKey,
  );
}

function mergeWindowRows(
  currentRows: Array<RowData | null>,
  windowRows: RowData[],
  start: number,
  rowCount: number,
): Array<RowData | null> {
  const nextRows = Array.from(
    { length: Math.max(currentRows.length, start + windowRows.length, rowCount) },
    (_, index) => currentRows[index] ?? null,
  );
  for (let index = 0; index < windowRows.length; index += 1) {
    const row = windowRows[index];
    if (row === undefined) continue;
    nextRows[start + index] = row;
  }
  return nextRows;
}

function applySavedRowKey(row: RowData | null, mapped: Map<string, string>): void {
  if (!isLoadedCsvTableRow(row)) return;
  const rowKey = cell(row[TABLE_ROW_KEY_FIELD]);
  const nextKey = mapped.get(rowKey);
  if (nextKey) row[TABLE_ROW_KEY_FIELD] = nextKey;
}
