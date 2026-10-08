import { defineStore } from 'pinia';
import { computed, reactive, ref, shallowReactive } from 'vue';
import { createFieldInputs, type FieldInputs } from '@/shared/runtime/field-inputs';
import type { CsvCellTarget } from '@/shared/types';
import {
  TABLE_KEYS,
  type CsvRowKeyMapping,
  type CsvTableRows,
  type CsvTableWindow,
  type ModTableState,
  type ProjectManifest,
  type RowData,
  type TableKey,
} from '@/shared/types';
import { getColumns } from '@/shared/lib/starsector';
import { isInternalJsonFieldKey } from '@/shared/lib/json-fields';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { csvDirtyCells } from '@/domain/tables/csv-dirty';
import { DEFAULT_CSV_FACTION_FILTER, filterFromOptionValue, filterOptionValue } from '@/domain/tables/csv-faction-filter';
import { useTablesEditHistoryStore } from '@/stores/tables-edit-history.store';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import {
  applyCsvTableWindowDraft,
  applySavedCsvRowKeyMapDraft,
  clearCsvTableExternalUpdateDraft,
  createCsvRowDraft,
  csvTableRowKey,
  deleteSelectedCsvRowDraft,
  discardCsvTableWindowForReloadDraft,
  hasCsvTableDraftChanges,
  markCsvTableExternalUpdateDraft,
  markCsvTableSavedDraft,
  replaceCsvTableDraft,
  setCsvCellValueDraft,
  csvRowTargetOf,
  type CsvDraftResult,
  type CsvRowTarget,
} from '@/domain/tables/csv-table-draft';
import { isLoadedCsvTableRow } from '@/domain/tables/csv-table-rows';

function emptyDirtyState(): ModTableState['dirty'] {
  return emptyTableRecord(() => ({}));
}

function emptyExternalUpdateState(): Record<TableKey, boolean> {
  return emptyTableRecord(() => false);
}

function emptyTablesRecord(): Record<TableKey, CsvTableRows> {
  return emptyTableRecord(() => []);
}

function emptyHeadersRecord(): Record<TableKey, string[]> {
  return emptyTableRecord(() => []);
}

function emptyCountRecord(): Record<TableKey, number> {
  return emptyTableRecord(() => 0);
}

function emptyTableRecord<T>(createValue: () => T): Record<TableKey, T> {
  return Object.fromEntries(TABLE_KEYS.map((key) => [key, createValue()])) as Record<TableKey, T>;
}

function createModTableState(): ModTableState {
  return {
    baseVersions: emptyTableRecord(() => []),
    tables: emptyTablesRecord(),
    originalTables: emptyTablesRecord(),
    headers: emptyHeadersRecord(),
    totalRows: emptyCountRecord(),
    filteredRows: emptyCountRecord(),
    dirty: emptyDirtyState(),
    pendingExternalTableUpdates: emptyExternalUpdateState(),
    currentTab: 'ships',
    currentFaction: DEFAULT_CSV_FACTION_FILTER,
    searchText: '',
    selectedRowKey: null,
    editing: null,
    nextRowKey: 0,
  };
}

function applyManifestSummaries(state: ModTableState, manifest: ProjectManifest) {
  for (const key of TABLE_KEYS) {
    const summary = manifest.tableSummaries[key];
    state.headers[key] = summary.header;
    if (summary.totalRows !== null) {
      state.totalRows[key] = summary.totalRows;
      state.filteredRows[key] = summary.totalRows;
    }
  }
}

export const useTablesStore = defineStore('tables', () => {
  const csvEditHistory = useTablesEditHistoryStore();
  const workspace = useWorkspaceStore();
  const stateMap = reactive<Map<string, ModTableState>>(new Map());
  const inputMap = shallowReactive(new Map<string, Map<TableKey, FieldInputs>>());
  const readGenerations = new WeakMap<ModTableState, Map<TableKey, number>>();
  const saving = ref(false);
  // Active mod identity is owned by the workspace store; tables projects it
  // onto its per-Mod table state instead of keeping its own copy in sync.
  const activeModRoot = computed(() => workspace.activeModRoot);

  function getActiveState(): ModTableState | undefined {
    return activeModRoot.value ? stateMap.get(activeModRoot.value) : undefined;
  }

  const tables = computed(() => getActiveState()?.tables ?? emptyTablesRecord());
  const currentTab = computed({
    get: () => getActiveState()?.currentTab ?? 'ships',
    set: (v) => {
      const s = getActiveState();
      if (s) s.currentTab = v;
    },
  });
  const currentFaction = computed({
    get: () => getActiveState()?.currentFaction ?? DEFAULT_CSV_FACTION_FILTER,
    set: (v) => {
      const s = getActiveState();
      if (s) s.currentFaction = v;
    },
  });
  const currentFactionOptionValue = computed({
    get: () => filterOptionValue(currentFaction.value),
    set: (v) => {
      currentFaction.value = filterFromOptionValue(v);
    },
  });
  const searchText = computed({
    get: () => getActiveState()?.searchText ?? '',
    set: (v) => {
      const s = getActiveState();
      if (s) s.searchText = v;
    },
  });
  const selectedRowKey = computed({
    get: () => getActiveState()?.selectedRowKey ?? null,
    set: (v) => {
      const s = getActiveState();
      if (s) s.selectedRowKey = v;
    },
  });
  const editing = computed({
    get: () => getActiveState()?.editing ?? null,
    set: (v) => {
      const s = getActiveState();
      if (s) s.editing = v;
    },
  });
  const dirty = computed(() => getActiveState()?.dirty ?? emptyDirtyState());

  const rows = computed(() => rowsFor(currentTab.value));
  const visibleColumns = computed(() => {
    const headerColumns = getColumns(currentTab.value, getActiveState()?.headers[currentTab.value] ?? []);
    if (headerColumns.length > 0) return headerColumns;
    const seen = new Set<string>();
    const inferred: string[] = [];
    for (const row of rows.value.filter(isLoadedCsvTableRow).slice(0, 50)) {
      for (const key of Object.keys(row)) {
        if (!isInternalJsonFieldKey(key) && !seen.has(key)) {
          seen.add(key);
          inferred.push(key);
        }
      }
    }
    return inferred;
  });
  const filteredRows = computed(() => rows.value);
  const filteredRowCount = computed(() => getActiveState()?.filteredRows[currentTab.value] ?? 0);
  const selectedRow = computed(() =>
    rows.value.find((row, index): row is RowData => isLoadedCsvTableRow(row) && tableRowKey(row, index) === selectedRowKey.value),
  );
  const tableInfo = computed(() => {
    const state = getActiveState();
    if (!state) return '显示 0 / 0 行';
    return `显示 ${state.filteredRows[state.currentTab]} / ${state.totalRows[state.currentTab]} 行`;
  });
  const hasAnyTableDirtyChanges = computed(() => TABLE_KEYS.some((key) => Object.keys(dirty.value[key]).length > 0));
  const hasCurrentTableChanges = computed(() => {
    const state = getActiveState();
    if (!state) return false;
    return hasTableDirtyChanges(state.currentTab);
  });
  const hasCurrentTableExternalUpdate = computed(() => {
    const state = getActiveState();
    return state ? state.pendingExternalTableUpdates[state.currentTab] : false;
  });
  const canUndoCurrentTableEdit = computed(() =>
    activeModRoot.value ? csvEditHistory.canUndoCsvEdit(activeModRoot.value, currentTab.value) : false,
  );
  const canRedoCurrentTableEdit = computed(() =>
    activeModRoot.value ? csvEditHistory.canRedoCsvEdit(activeModRoot.value, currentTab.value) : false,
  );
  const hasAnyTableChanges = computed(() => (activeModRoot.value ? hasModDirtyChanges(activeModRoot.value) : false));

  // --- Per-Mod lifecycle ---

  function hydrate(modRoot: string, manifest: ProjectManifest) {
    const state = createModTableState();
    applyManifestSummaries(state, manifest);
    stateMap.set(modRoot, state);
    inputMap.get(modRoot)?.forEach((inputs) => inputs.release());
    inputMap.set(
      modRoot,
      new Map(TABLE_KEYS.map((table) => [table, createFieldInputs(ref(JSON.stringify([manifest.sessionId, modRoot, table])))])),
    );
  }

  function hydrateWithoutActivate(modRoot: string, manifest: ProjectManifest) {
    hydrate(modRoot, manifest);
  }

  function activateFor(modRoot: string | null, manifest?: ProjectManifest | null) {
    const state = modRoot ? stateMap.get(modRoot) : undefined;
    if (state && manifest) applyManifestSummaries(state, manifest);
  }

  function removeModState(modRoot: string) {
    inputMap.get(modRoot)?.forEach((inputs) => inputs.release());
    inputMap.delete(modRoot);
    stateMap.delete(modRoot);
  }

  function hasModDirtyChanges(modRoot: string): boolean {
    const state = stateMap.get(modRoot);
    if (!state) return false;
    return TABLE_KEYS.some((key) => Object.keys(state.dirty[key]).length > 0 || inputMap.get(modRoot)?.get(key)?.dirty.value);
  }

  // Table unsaved state joins the unsaved-work registry for unified Mod-level queries.
  useDraftSessionsStore().registerDirtySource(hasModDirtyChanges);

  // --- Existing API ---

  function rowsFor(tab: TableKey): CsvTableRows {
    return getActiveState()?.tables[tab] ?? [];
  }

  function switchTab(modRoot: string, tab: TableKey) {
    const state = stateMap.get(modRoot)!;
    if (state.currentTab === tab) return;
    state.currentTab = tab;
    state.selectedRowKey = null;
    state.searchText = '';
    state.currentFaction = DEFAULT_CSV_FACTION_FILTER;
  }

  function applyTableWindow(window: CsvTableWindow) {
    const state = getActiveState();
    if (!state) return;
    applyCsvTableWindowDraft(state, window, getTableInputs(activeModRoot.value!, window.table).dirty.value);
  }

  function hasTableDirtyChanges(tab: TableKey): boolean {
    const state = getActiveState();
    if (!state) return false;
    return hasCsvTableDraftChanges(state, tab) || getTableInputs(activeModRoot.value!, tab).dirty.value;
  }

  function markTableExternalUpdate(tab: TableKey) {
    const state = getActiveState();
    if (!state) return;
    markCsvTableExternalUpdateDraft(state, tab);
  }

  function clearTableExternalUpdate(tab: TableKey) {
    const state = getActiveState();
    if (!state) return;
    clearCsvTableExternalUpdateDraft(state, tab);
  }

  function tableRowKey(row: RowData, index: number): string {
    return csvTableRowKey(currentTab.value, row, index);
  }

  function selectRowByKey(rowKey: string | null) {
    selectedRowKey.value = rowKey;
  }

  function isDirty(rowKey: string, col: string): boolean {
    return csvDirtyCells(dirty.value[currentTab.value][rowKey])?.[col] !== undefined;
  }

  function getTableInputs(modRoot: string, table: TableKey): FieldInputs {
    return inputMap.get(modRoot)!.get(table)!;
  }

  function tableReadGeneration(modRoot: string, table: TableKey) {
    return readGenerations.get(stateMap.get(modRoot)!)?.get(table) ?? 0;
  }

  function revokeTableReads(modRoot: string, table: TableKey) {
    const state = stateMap.get(modRoot)!;
    const generations = readGenerations.get(state) ?? new Map<TableKey, number>();
    generations.set(table, (generations.get(table) ?? 0) + 1);
    readGenerations.set(state, generations);
  }

  function setActiveCell(target: CsvCellTarget | null, modRoot: string) {
    const state = stateMap.get(modRoot);
    if (state) state.editing = target;
  }

  function updateCellValue(target: CsvCellTarget, value: string) {
    const state = stateMap.get(target.modRoot)!;
    pushCsvDraftResult(target.table, setCsvCellValueDraft(state, target.table, target.rowKey, target.column, value), target.modRoot);
  }

  function undoCurrentTableEdit(): string | null {
    if (activeModRoot.value) revokeTableReads(activeModRoot.value, currentTab.value);
    return activeModRoot.value ? csvEditHistory.undoCsvEdit(activeModRoot.value, currentTab.value, getActiveState()) : null;
  }

  function redoCurrentTableEdit(): string | null {
    if (activeModRoot.value) revokeTableReads(activeModRoot.value, currentTab.value);
    return activeModRoot.value ? csvEditHistory.redoCsvEdit(activeModRoot.value, currentTab.value, getActiveState()) : null;
  }

  function addNewRow(): CsvRowTarget | null {
    const state = getActiveState();
    if (!state) return null;
    const result = createCsvRowDraft(state, Date.now());
    pushCsvDraftResult(state.currentTab, result);
    return csvRowTargetOf(result);
  }

  function deleteSelected(): CsvRowTarget | null {
    const state = getActiveState();
    if (!state) return null;
    const result = deleteSelectedCsvRowDraft(state);
    pushCsvDraftResult(state.currentTab, result);
    return csvRowTargetOf(result);
  }

  function getActiveModTableState(): ModTableState | undefined {
    return getActiveState();
  }

  function getModTableState(modRoot: string): ModTableState | undefined {
    return stateMap.get(modRoot);
  }

  function replaceTableForMod(modRoot: string, tab: TableKey, rows: RowData[]) {
    const state = stateMap.get(modRoot);
    if (!state) return;
    revokeTableReads(modRoot, tab);
    replaceCsvTableDraft(state, tab, rows);
  }

  function discardTableDraftForReload(tab: TableKey) {
    const state = getActiveState();
    if (!state) return;
    revokeTableReads(activeModRoot.value!, tab);
    getTableInputs(activeModRoot.value!, tab).cancel();
    discardCsvTableWindowForReloadDraft(state, tab);
  }

  function markTableSavedForMod(modRoot: string, tab: TableKey) {
    const state = stateMap.get(modRoot);
    if (!state) return;
    markCsvTableSavedDraft(state, tab);
  }

  function applySavedRowKeyMapForMod(modRoot: string, tab: TableKey, keyMap: CsvRowKeyMapping[]) {
    const state = stateMap.get(modRoot);
    if (!state) return;
    applySavedCsvRowKeyMapDraft(state, tab, keyMap);
  }

  function pushCsvDraftResult(table: TableKey, result: CsvDraftResult, modRoot = activeModRoot.value) {
    if (!modRoot || !result.historyOperation || !result.historyLabel) return;
    revokeTableReads(modRoot, table);
    csvEditHistory.pushCsvDraftOperation(modRoot, table, result.historyOperation, result.historyLabel);
  }

  function setSaving(value: boolean) {
    saving.value = value;
  }

  return {
    currentFaction,
    currentFactionOptionValue,
    currentTab,
    activeModRoot,
    canRedoCurrentTableEdit,
    canUndoCurrentTableEdit,
    dirty,
    editing,
    filteredRowCount,
    filteredRows,
    hasCurrentTableChanges,
    hasCurrentTableExternalUpdate,
    hasAnyTableChanges,
    hasAnyTableDirtyChanges,
    isDirty,
    rows,
    saving,
    searchText,
    selectedRow,
    selectedRowKey,
    tableInfo,
    tables,
    visibleColumns,
    activateFor,
    addNewRow,
    deleteSelected,
    getTableInputs,
    tableReadGeneration,
    revokeTableReads,
    setActiveCell,
    getActiveModTableState,
    getModTableState,
    hasModDirtyChanges,
    hydrate,
    hydrateWithoutActivate,
    markTableSavedForMod,
    markTableExternalUpdate,
    removeModState,
    replaceTableForMod,
    discardTableDraftForReload,
    redoCurrentTableEdit,
    rowsFor,
    selectRowByKey,
    setSaving,
    clearTableExternalUpdate,
    switchTab,
    applySavedRowKeyMapForMod,
    applyTableWindow,
    hasTableDirtyChanges,
    tableRowKey,
    undoCurrentTableEdit,
    updateCellValue,
  };
});
