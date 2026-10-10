import type {
  CsvDraftOperation,
  CsvRowKeyMapping,
  CsvRowPatch,
  CsvTableWindow,
  ModTableState,
  CsvDraftRow,
  RowData,
  TableKey,
} from '@/shared/types';
import { cell, deepClone, rowDisplayId } from '@/shared/lib/starsector';
import { createCsvDeletedRow, createCsvDirtyCells, csvDirtyCells, hasCsvDirtyCells } from '@/domain/tables/csv-dirty';
import { defaultCsvFactionId } from '@/domain/tables/csv-faction-filter';
import { isLoadedCsvTableRow } from '@/domain/tables/csv-table-rows';
import { createTableRowKey } from '@/domain/tables/table-row-key';
import type { DeepReadonly } from '@/shared/types';
import { stableDeepEqual } from '@/shared/lib/stable-compare';

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

export function applyCsvTableWindowDraft(
  state: ModTableState,
  record: DeepReadonly<CsvTableWindow>,
  hasPendingInput = false,
): CsvDraftResult {
  const table = record.table;
  if (hasCsvTableDraftChanges(state, table) || hasPendingInput) {
    const originalRows = new Map(state.originalTables[table].filter(isLoadedCsvTableRow).map((row) => [row.rowKey, row]));
    const sameBaseline =
      stableDeepEqual(state.baseVersions[table], record.baseVersions) &&
      record.rows.every((entry) => {
        const original = originalRows.get(entry.rowKey);
        return original !== undefined && original.isComment === entry.isComment && stableDeepEqual(original.data, entry.data);
      });
    if (sameBaseline) {
      for (const entry of record.rows) {
        const original = originalRows.get(entry.rowKey)!;
        original.factionId = entry.factionId;
        original.sourceRowIndex = entry.sourceRowIndex;
        const current = findLoadedRow(state, table, entry.rowKey);
        if (current) {
          current.factionId = entry.factionId;
          current.sourceRowIndex = entry.sourceRowIndex;
        }
      }
      return { changed: true };
    }
    state.pendingExternalTableUpdates[table] = true;
    return { changed: false, externalUpdateMarked: true };
  }
  state.headers[table] = [...record.header];
  state.baseVersions[table] = [...record.baseVersions];
  state.totalRows[table] = record.totalRows;
  state.filteredRows[table] = record.filteredRows;
  const rows: CsvDraftRow[] = record.rows.map((entry) => ({
    rowKey: entry.rowKey,
    data: deepClone(entry.data) as RowData,
    isComment: entry.isComment,
    factionId: entry.factionId,
    sourceRowIndex: entry.sourceRowIndex,
    insertAt: null,
  }));
  state.tables[table] = mergeWindowRows(state.tables[table], rows, record.start, record.filteredRows);
  state.originalTables[table] = mergeWindowRows(state.originalTables[table], deepClone(rows), record.start, record.filteredRows);
  return { changed: true };
}

export function hasCsvTableDraftChanges(state: ModTableState, table: TableKey): boolean {
  return Object.keys(state.dirty[table]).length > 0;
}

export function markCsvTableExternalUpdateDraft(state: ModTableState, table: TableKey): void {
  state.pendingExternalTableUpdates[table] = true;
}

export function clearCsvTableExternalUpdateDraft(state: ModTableState, table: TableKey): void {
  state.pendingExternalTableUpdates[table] = false;
}

export function setCsvCellValueDraft(state: ModTableState, tab: TableKey, rowKey: string, col: string, value: string): CsvDraftResult {
  const row = findLoadedRow(state, tab, rowKey);
  if (!row) return { changed: false };
  const previousValue = cell(row.data[col]);
  const previousIsComment = row.isComment;
  row.data[col] = value;
  if (col === state.headers[tab][0] && value !== previousValue) {
    const original = findOriginalRow(state, tab, rowKey);
    row.isComment = original && value === cell(original.data[col]) ? original.isComment : value.startsWith('#');
  }
  refreshCsvCellDirty(state, tab, row, col, value);
  if (value === previousValue) return { changed: true };
  return {
    changed: true,
    historyLabel: `编辑 ${tab} [${col}]`,
    historyOperation: {
      type: 'cell-value-set',
      tab,
      rowKey,
      col,
      previousValue,
      newValue: value,
      previousIsComment,
      newIsComment: row.isComment,
    },
  };
}

export function createCsvRowDraft(state: ModTableState, now: number): CsvDraftResult {
  const tab = state.currentTab;
  const id = `new_${tab}_${now}`;
  const row: CsvDraftRow = {
    rowKey: createTableRowKey(tab, state.nextRowKey++),
    data: Object.fromEntries(state.headers[tab].map((col) => [col, ''])),
    isComment: false,
    factionId: defaultCsvFactionId(),
    sourceRowIndex: null,
    insertAt: null,
  };
  if ('id' in row.data) row.data.id = id;
  if ('name' in row.data) row.data.name = id;

  state.tables[tab].push(row);
  adjustCsvTableRowCounts(state, tab, 1);
  const rowIndex = state.tables[tab].length - 1;
  const rowKey = row.rowKey;
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
  const id = rowDisplayId(row.data) || `第 ${rowIndex + 1} 行`;
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
      direction === 'undo' ? operation.previousIsComment : operation.newIsComment,
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
      return typeof row?.sourceRowIndex === 'number' ? [row.sourceRowIndex] : [];
    });
  const restoredPositions = patches
    .filter((patch) => patch.action === 'delete')
    .flatMap((patch) => {
      const row = findLoadedRow(state, tab, patch.rowKey);
      return typeof row?.sourceRowIndex === 'number' ? [row.sourceRowIndex] : [];
    });
  const insertedKeys = new Set(keyMap.map((mapping) => mapping.nextKey));
  const insertedPositions = keyMap.map((mapping) => mapping.rowIndex).sort((left, right) => left - right);
  applySavedCsvRowKeyMapDraft(state, tab, keyMap);
  const original = state.originalTables[tab];
  const mapped = new Map(keyMap.map((item) => [item.previousKey, item.nextKey]));
  for (const patch of patches) {
    const rowKey = mapped.get(patch.rowKey) ?? patch.rowKey;
    const index = original.findIndex((candidate) => isLoadedCsvTableRow(candidate) && candidate.rowKey === rowKey);
    if (patch.action === 'delete') {
      if (index >= 0) original.splice(index, 1);
      const restored = findLoadedRow(state, tab, rowKey);
      if (restored) {
        const previousKey = rowKey;
        const nextKey = createTableRowKey(tab, state.nextRowKey++);
        const sourceIndex = typeof restored.sourceRowIndex === 'number' ? restored.sourceRowIndex : 0;
        const rowIndex =
          sourceIndex -
          removedPositions.filter((position) => position < sourceIndex).length +
          restoredPositions.filter((position) => position < sourceIndex).length;
        restored.insertAt = rowIndex;
        const mapping = { previousKey, nextKey, rowIndex };
        keyMap.push(mapping);
        applySavedCsvRowKeyMapDraft(state, tab, [mapping]);
      }
      continue;
    }
    const sourceIndex =
      keyMap.find((mapping) => mapping.nextKey === rowKey)?.rowIndex ?? (index >= 0 ? original[index]?.sourceRowIndex : undefined);
    const savedRow: CsvDraftRow = {
      data: deepClone(patch.row),
      isComment: patch.isComment,
      rowKey,
      factionId: findLoadedRow(state, tab, rowKey)?.factionId ?? null,
      sourceRowIndex: sourceIndex ?? null,
      insertAt: null,
    };
    if (index >= 0) original[index] = savedRow;
    else original.push(savedRow);
  }
  for (const row of [...state.tables[tab], ...state.originalTables[tab]]) {
    if (!row || typeof row.sourceRowIndex !== 'number' || insertedKeys.has(row.rowKey)) continue;
    row.sourceRowIndex -= removedPositions.filter((position) => position < (row.sourceRowIndex as number)).length;
    for (const position of insertedPositions) {
      if (row.sourceRowIndex >= position) row.sourceRowIndex++;
    }
  }
  rebuildCsvDirty(state, tab);
  state.pendingExternalTableUpdates[tab] = false;
}

export function replaceCsvTableDraft(state: ModTableState, tab: TableKey, rows: CsvDraftRow[]): void {
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
    const mapping = keyMap.find((mapping) => mapping.nextKey === row.rowKey);
    if (mapping && !mapping.nextKey.includes(':new:')) {
      row.sourceRowIndex = mapping.rowIndex;
      row.insertAt = null;
    }
  }
  if (state.selectedRowKey) {
    state.selectedRowKey = mapped.get(state.selectedRowKey) ?? state.selectedRowKey;
  }
  if (state.editing?.table === tab) {
    state.editing.rowKey = mapped.get(state.editing.rowKey) ?? state.editing.rowKey;
  }
}

function setCsvCellValueForReplay(
  state: ModTableState,
  tab: TableKey,
  rowKey: string,
  col: string,
  value: string,
  isComment: boolean,
): boolean {
  const row = findLoadedRow(state, tab, rowKey);
  if (!row) return false;
  row.data[col] = value;
  if (col === state.headers[tab][0]) row.isComment = isComment;
  refreshCsvCellDirty(state, tab, row, col, value);
  return true;
}

function insertCsvRowForReplay(state: ModTableState, tab: TableKey, rowIndex: number, rowKey: string, row: CsvDraftRow): boolean {
  if (state.tables[tab].some((candidate) => isLoadedCsvTableRow(candidate) && candidate.rowKey === rowKey)) return true;
  const next = deepClone(row);
  next.rowKey = rowKey;
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
  if (state.editing?.table === tab && state.editing.rowKey === rowKey) state.editing = null;
  return true;
}

function adjustCsvTableRowCounts(state: ModTableState, tab: TableKey, delta: number): void {
  state.totalRows[tab] = Math.max(0, state.totalRows[tab] + delta);
  state.filteredRows[tab] = Math.max(0, state.filteredRows[tab] + delta);
}

function refreshCsvCellDirty(state: ModTableState, tab: TableKey, row: CsvDraftRow, col: string, value: string): void {
  const rowKey = row.rowKey;
  const original = findOriginalRow(state, tab, rowKey);
  const originalValue = cell(original?.data[col]);
  if (value !== originalValue || (col === state.headers[tab][0] && row.isComment !== original?.isComment)) {
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
  const originalByKey = new Map(state.originalTables[tab].flatMap((row) => (isLoadedCsvTableRow(row) ? [[row.rowKey, row] as const] : [])));
  const currentKeys = new Set<string>();
  for (const row of state.tables[tab]) {
    if (!isLoadedCsvTableRow(row)) continue;
    const rowKey = row.rowKey;
    currentKeys.add(rowKey);
    const original = originalByKey.get(rowKey);
    for (const [key, value] of Object.entries(row.data)) {
      if (
        !original ||
        cell(value) !== cell(original.data[key]) ||
        (key === state.headers[tab][0] && row.isComment !== original.isComment)
      ) {
        ensureCsvDirtyCells(state, tab, rowKey)[key] = cell(value);
      }
    }
    if (!original && !dirty[rowKey]) dirty[rowKey] = createCsvDirtyCells();
  }
  for (const rowKey of originalByKey.keys()) {
    if (!currentKeys.has(rowKey)) dirty[rowKey] = createCsvDeletedRow();
  }
}

function markCsvRowDirty(state: ModTableState, tab: TableKey, rowKey: string, row: CsvDraftRow): void {
  const original = findOriginalRow(state, tab, rowKey);
  delete state.dirty[tab][rowKey];
  if (!original) {
    state.dirty[tab][rowKey] = createCsvDirtyCells();
    const cells = csvDirtyCells(state.dirty[tab][rowKey]);
    if (!cells) return;
    for (const [key, value] of Object.entries(row.data)) {
      cells[key] = cell(value);
    }
    return;
  }
  for (const [key, value] of Object.entries(row.data)) {
    const next = cell(value);
    const prev = cell(original.data[key]);
    if (next !== prev || (key === state.headers[tab][0] && row.isComment !== original.isComment))
      ensureCsvDirtyCells(state, tab, rowKey)[key] = next;
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

function findLoadedRow(state: ModTableState, tab: TableKey, rowKey: string): CsvDraftRow | null {
  return (
    state.tables[tab].find((candidate): candidate is CsvDraftRow => isLoadedCsvTableRow(candidate) && candidate.rowKey === rowKey) ?? null
  );
}

function findOriginalRow(state: ModTableState, tab: TableKey, rowKey: string): CsvDraftRow | null {
  return (
    state.originalTables[tab].find(
      (candidate): candidate is CsvDraftRow => isLoadedCsvTableRow(candidate) && candidate.rowKey === rowKey,
    ) ?? null
  );
}

function findLoadedRowIndex(state: ModTableState, tab: TableKey, rowKey: string): number {
  return state.tables[tab].findIndex((candidate) => isLoadedCsvTableRow(candidate) && candidate.rowKey === rowKey);
}

function mergeWindowRows(
  currentRows: Array<CsvDraftRow | null>,
  windowRows: CsvDraftRow[],
  start: number,
  rowCount: number,
): Array<CsvDraftRow | null> {
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

function applySavedRowKey(row: CsvDraftRow | null, mapped: Map<string, string>): void {
  if (!isLoadedCsvTableRow(row)) return;
  const rowKey = row.rowKey;
  const nextKey = mapped.get(rowKey);
  if (nextKey) row.rowKey = nextKey;
}
