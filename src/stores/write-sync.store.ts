import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { FileChangeRecord, ProjectSessionInvalidationResult } from '@/shared/types';

export interface PendingWriteSync {
  id: number;
  modRoot: string;
  sessionId: string;
  changes: FileChangeRecord[];
  refreshed: ProjectSessionInvalidationResult | null;
  error: string | null;
}

export const useWriteSyncStore = defineStore('write-sync', () => {
  const pending = ref<PendingWriteSync[]>([]);
  let sequence = 0;

  function enqueue(modRoot: string, sessionId: string, changes: FileChangeRecord[]) {
    const entry: PendingWriteSync = { id: ++sequence, modRoot, sessionId, changes, refreshed: null, error: null };
    pending.value.push(entry);
    return entry;
  }

  function markRefreshed(id: number, refreshed: ProjectSessionInvalidationResult) {
    pending.value.find((entry) => entry.id === id)!.refreshed = refreshed;
  }

  function complete(id: number) {
    pending.value = pending.value.filter((entry) => entry.id !== id);
  }

  function removeModState(modRoot: string) {
    pending.value = pending.value.filter((entry) => entry.modRoot !== modRoot);
  }

  function markFailed(id: number, error: string) {
    const entry = pending.value.find((entry) => entry.id === id);
    if (entry) entry.error = error;
  }

  return { pending, enqueue, markRefreshed, complete, removeModState, markFailed };
});
