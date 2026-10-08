import { ref, shallowReactive, type Ref } from 'vue';
import { defineStore } from 'pinia';

type SaveHandler = () => void | Promise<void>;

interface SaveSessionHandle {
  targetKey: Readonly<Ref<string | null>>;
  modRoot: Readonly<Ref<string | null>>;
  saving: Readonly<Ref<boolean>>;
  waitForSave: () => Promise<boolean>;
}

// Registry of the active Ctrl+S save target in the main window: exactly one surface
// holds the save right at a time.
export const useSaveCommandStore = defineStore('save-command', () => {
  const activeHandler = ref<SaveHandler | null>(null);
  const sessions = shallowReactive(new Set<SaveSessionHandle>());
  let transitionSequence = 0;

  function registerSaveSession(handle: SaveSessionHandle) {
    sessions.add(handle);
    return () => sessions.delete(handle);
  }
  function hasPendingSave(modRoot?: string | null) {
    return [...sessions].some((handle) => handle.saving.value && (modRoot == null || handle.modRoot.value === modRoot));
  }
  function waitForSaves(modRoot?: string | null, targetKey?: string | null): Promise<boolean> | undefined {
    const pending = [...sessions].filter(
      (handle) =>
        handle.saving.value &&
        (modRoot == null || handle.modRoot.value === modRoot) &&
        (targetKey == null || handle.targetKey.value === targetKey),
    );
    if (pending.length === 0) return;
    return Promise.all(pending.map((handle) => handle.waitForSave())).then((outcomes) => outcomes.every(Boolean));
  }
  function beginTransition() {
    return ++transitionSequence;
  }
  function isTransitionCurrent(sequence: number) {
    return sequence === transitionSequence;
  }

  function registerActiveSaveHandler(handler: SaveHandler): void {
    activeHandler.value = handler;
  }

  function unregisterActiveSaveHandler(handler: SaveHandler): void {
    if (activeHandler.value === handler) {
      activeHandler.value = null;
    }
  }

  function dispatchSaveCommand(): boolean {
    if (!activeHandler.value) return false;
    if (!hasPendingSave()) void activeHandler.value();
    return true;
  }

  return {
    registerActiveSaveHandler,
    unregisterActiveSaveHandler,
    dispatchSaveCommand,
    registerSaveSession,
    hasPendingSave,
    waitForSaves,
    beginTransition,
    isTransitionCurrent,
  };
});
