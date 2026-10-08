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
import type { CsvRowKeyMapping, ModTableState, TableKey } from '@/shared/types';
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

  function applySavedRowKeyMap(modRoot: string, table: TableKey, keyMap: CsvRowKeyMapping[]) {
    const stack = getStack(modRoot, table);
    if (!stack) return;
    const mapped = new Map(keyMap.map((item) => [item.previousKey, item.nextKey]));
    for (const entry of [...stack.undoStack, ...stack.redoStack]) {
      entry.operation.rowKey = mapped.get(entry.operation.rowKey) ?? entry.operation.rowKey;
      if (entry.operation.type !== 'cell-value-set') {
        const mapping = keyMap.find((mapping) => mapping.nextKey === entry.operation.rowKey);
        if (mapping?.nextKey.includes(':new:')) entry.operation.row._insertAt = mapping.rowIndex;
      }
    }
  }

  function captureSaveHistory(modRoot: string, table: TableKey) {
    const stack = getStack(modRoot, table);
    return {
      undoIds: new Set(stack?.undoStack.map((entry) => entry.id) ?? []),
      redoIds: new Set(stack?.redoStack.map((entry) => entry.id) ?? []),
    };
  }

  function commitSaveHistory(modRoot: string, table: TableKey, submitted: ReturnType<typeof captureSaveHistory>) {
    const stack = getStack(modRoot, table);
    if (!stack) return;
    stack.undoStack = stack.undoStack.filter((entry) => !submitted.undoIds.has(entry.id));
    stack.redoStack = stack.redoStack.filter((entry) => !submitted.redoIds.has(entry.id));
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
    applySavedRowKeyMap,
    captureSaveHistory,
    commitSaveHistory,
    canUndoCsvEdit,
    clearCsvEditHistory,
    clearForMod,
    pushCsvDraftOperation,
    redoCsvEdit,
    setHistoryLimit,
    undoCsvEdit,
  };
});
