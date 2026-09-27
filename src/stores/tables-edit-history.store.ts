import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import {
  canRedoEntry,
  canUndoEntry,
  createUndoStackState,
  nextUndoStackId,
  peekRedoEntry,
  peekUndoEntry,
  popRedoEntry,
  popUndoEntry,
  pushRedoEntry,
  pushUndoEntry,
  setUndoStackLimit,
  type UndoStackState,
} from '@/domain/edit-session';
import type { ModTableState, TableKey } from '@/shared/types';
import { applyCsvEditRedo, applyCsvEditUndo } from '@/domain/tables/csv-edit-history';
import type { CsvDraftOperation, CsvEditHistoryEntry } from '@/shared/types';

type CsvEditHistoryStack = UndoStackState<CsvEditHistoryEntry>;

function createCsvEditHistoryStack(limit: number): CsvEditHistoryStack {
  return createUndoStackState<CsvEditHistoryEntry>(limit);
}

export const useTablesEditHistoryStore = defineStore('tables-edit-history', () => {
  const stateMap = reactive<Map<string, Map<TableKey, CsvEditHistoryStack>>>(new Map());
  const historyLimit = ref(100);

  function getOrCreateStack(modRoot: string, table: TableKey): CsvEditHistoryStack {
    let tableStates = stateMap.get(modRoot);
    if (!tableStates) {
      tableStates = new Map();
      stateMap.set(modRoot, tableStates);
    }
    let stack = tableStates.get(table);
    if (!stack) {
      stack = createCsvEditHistoryStack(historyLimit.value);
      tableStates.set(table, stack);
    }
    return stack;
  }

  function getStack(modRoot: string, table: TableKey): CsvEditHistoryStack | undefined {
    return stateMap.get(modRoot)?.get(table);
  }

  function pushCsvDraftOperation(modRoot: string, table: TableKey, operation: CsvDraftOperation, label: string) {
    if (!modRoot) return;
    const stack = getOrCreateStack(modRoot, table);
    pushUndoEntry(stack, { id: nextUndoStackId(stack, 'csv_edit'), timestamp: Date.now(), operation, label });
  }

  function canUndoCsvEdit(modRoot: string, table: TableKey): boolean {
    const stack = getStack(modRoot, table);
    return stack ? canUndoEntry(stack) : false;
  }

  function canRedoCsvEdit(modRoot: string, table: TableKey): boolean {
    const stack = getStack(modRoot, table);
    return stack ? canRedoEntry(stack) : false;
  }

  function undoCsvEdit(modRoot: string, table: TableKey, tableState: ModTableState | undefined): string | null {
    const stack = getStack(modRoot, table);
    const entry = stack ? peekUndoEntry(stack) : undefined;
    if (!stack || !entry) return null;
    if (!applyCsvEditUndo(entry, tableState)) return null;
    popUndoEntry(stack);
    pushRedoEntry(stack, entry);
    return entry.label;
  }

  function redoCsvEdit(modRoot: string, table: TableKey, tableState: ModTableState | undefined): string | null {
    const stack = getStack(modRoot, table);
    const entry = stack ? peekRedoEntry(stack) : undefined;
    if (!stack || !entry) return null;
    if (!applyCsvEditRedo(entry, tableState)) return null;
    popRedoEntry(stack);
    pushUndoEntry(stack, entry, { clearRedo: false });
    return entry.label;
  }

  function clearCsvEditHistory(modRoot: string, table: TableKey) {
    const tableStates = stateMap.get(modRoot);
    tableStates?.delete(table);
    if (tableStates?.size === 0) stateMap.delete(modRoot);
  }

  function clearForMod(modRoot: string) {
    stateMap.delete(modRoot);
  }

  function setHistoryLimit(limit: number) {
    historyLimit.value = limit;
    for (const tableStates of stateMap.values()) {
      for (const stack of tableStates.values()) setUndoStackLimit(stack, limit);
    }
  }

  return {
    canRedoCsvEdit,
    canUndoCsvEdit,
    clearCsvEditHistory,
    clearForMod,
    pushCsvDraftOperation,
    redoCsvEdit,
    setHistoryLimit,
    undoCsvEdit,
  };
});
