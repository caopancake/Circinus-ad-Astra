import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import {
  clearUndoStack,
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
import type { FileChangeRecord } from '@/shared/types';
import type { FileSaveHistoryEntry } from '@/shared/types';

type FileHistoryStack = UndoStackState<FileSaveHistoryEntry>;

function createFileHistoryStack(limit: number): FileHistoryStack {
  return createUndoStackState<FileSaveHistoryEntry>(limit);
}

export const useFileHistoryStore = defineStore('file-history', () => {
  const stateMap = reactive<Map<string, FileHistoryStack>>(new Map());
  const historyLimit = ref(100);

  function activateFor(modRoot: string | null) {
    if (modRoot && !stateMap.has(modRoot)) stateMap.set(modRoot, createFileHistoryStack(historyLimit.value));
  }

  function removeModState(modRoot: string) {
    stateMap.delete(modRoot);
  }

  function getStack(modRoot: string | null): FileHistoryStack | undefined {
    return modRoot ? stateMap.get(modRoot) : undefined;
  }

  // Caller contract (validated by file-history-write.orchestrator): modRoot
  // is non-empty and changes is non-empty.
  function pushSavedWriteEntry(modRoot: string, changes: FileChangeRecord[], label: string) {
    const stack = getStack(modRoot) ?? stateMap.set(modRoot, createFileHistoryStack(historyLimit.value)).get(modRoot)!;
    pushUndoEntry(stack, { id: nextUndoStackId(stack, 'file_hist'), timestamp: Date.now(), kind: 'file-save', changes, label });
  }

  function peekSavedWriteUndo(modRoot: string | null): FileSaveHistoryEntry | null {
    const stack = getStack(modRoot);
    return stack ? (peekUndoEntry(stack) ?? null) : null;
  }

  function peekSavedWriteRedo(modRoot: string | null): FileSaveHistoryEntry | null {
    const stack = getStack(modRoot);
    return stack ? (peekRedoEntry(stack) ?? null) : null;
  }

  function commitReplayUndo(modRoot: string | null, entryId: string): boolean {
    const stack = getStack(modRoot);
    const top = stack ? peekUndoEntry(stack) : undefined;
    if (!stack || !top || top.id !== entryId) return false;
    popUndoEntry(stack);
    pushRedoEntry(stack, top);
    return true;
  }

  function commitReplayRedo(modRoot: string | null, entryId: string): boolean {
    const stack = getStack(modRoot);
    const top = stack ? peekRedoEntry(stack) : undefined;
    if (!stack || !top || top.id !== entryId) return false;
    popRedoEntry(stack);
    pushUndoEntry(stack, top, { clearRedo: false });
    return true;
  }

  function clearForMod(modRoot: string) {
    const stack = getStack(modRoot);
    if (stack) clearUndoStack(stack);
  }

  function getHistoryStacks(modRoot: string) {
    const stack = getStack(modRoot);
    return {
      undoStack: stack?.undoStack ?? [],
      redoStack: stack?.redoStack ?? [],
    };
  }

  function setHistoryLimit(limit: number) {
    historyLimit.value = limit;
    for (const stack of stateMap.values()) setUndoStackLimit(stack, limit);
  }

  return {
    activateFor,
    clearForMod,
    commitReplayRedo,
    commitReplayUndo,
    peekSavedWriteRedo,
    peekSavedWriteUndo,
    getHistoryStacks,
    removeModState,
    pushSavedWriteEntry,
    setHistoryLimit,
  };
});
