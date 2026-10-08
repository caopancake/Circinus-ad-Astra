import { defineStore } from 'pinia';
import { reactive } from 'vue';
import type { FileHistorySnapshot } from '@/shared/types';

export const useFileHistoryStore = defineStore('file-history', () => {
  const snapshots = reactive(new Map<string, FileHistorySnapshot>());
  function activateFor(modRoot: string | null) {
    if (modRoot && !snapshots.has(modRoot)) snapshots.set(modRoot, { revision: 0, undoStack: [], redoStack: [] });
  }
  function applySnapshot(modRoot: string, snapshot: FileHistorySnapshot) {
    if (snapshot.revision < (snapshots.get(modRoot)?.revision ?? 0)) return;
    snapshots.set(modRoot, snapshot);
  }
  function getHistoryStacks(modRoot: string): FileHistorySnapshot {
    return snapshots.get(modRoot) ?? { revision: 0, undoStack: [], redoStack: [] };
  }
  function peekSavedWriteUndo(modRoot: string | null) {
    return modRoot ? (getHistoryStacks(modRoot).undoStack.at(-1) ?? null) : null;
  }
  function peekSavedWriteRedo(modRoot: string | null) {
    return modRoot ? (getHistoryStacks(modRoot).redoStack.at(-1) ?? null) : null;
  }
  function removeModState(modRoot: string) {
    snapshots.delete(modRoot);
  }
  return { activateFor, applySnapshot, getHistoryStacks, peekSavedWriteUndo, peekSavedWriteRedo, removeModState };
});
