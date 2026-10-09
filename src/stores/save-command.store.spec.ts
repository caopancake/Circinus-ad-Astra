import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { useSaveCommandStore } from './save-command.store';

describe('useSaveCommandStore', () => {
  it('waits for pending synchronization and allows the active save to trigger its retry', async () => {
    const commands = useSaveCommandStore();
    const pendingSynchronization = ref(true);
    const retry = vi.fn(async () => {
      pendingSynchronization.value = false;
      return true;
    });
    commands.registerSaveSession({
      targetKey: ref('target'),
      modRoot: ref('M:/mod'),
      saving: ref(false),
      pendingSynchronization,
      waitForSave: retry,
    });
    const handler = vi.fn();
    commands.registerActiveSaveHandler(handler);
    expect(commands.hasPendingSave('M:/mod')).toBe(true);
    commands.dispatchSaveCommand();
    expect(handler).toHaveBeenCalledOnce();
    await expect(commands.waitForSaves('M:/mod')).resolves.toBe(true);
    expect(retry).toHaveBeenCalledOnce();
    expect(commands.hasPendingSave('M:/mod')).toBe(false);
  });
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('starts without an active save handler', () => {
    const store = useSaveCommandStore();
    expect(store.dispatchSaveCommand()).toBe(false);
  });

  it('dispatches to the registered handler', () => {
    const store = useSaveCommandStore();
    const handler = vi.fn();
    store.registerActiveSaveHandler(handler);
    expect(store.dispatchSaveCommand()).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unregisters only the matching handler instance', () => {
    const store = useSaveCommandStore();
    const first = vi.fn();
    const second = vi.fn();
    store.registerActiveSaveHandler(first);
    store.unregisterActiveSaveHandler(second);
    expect(store.dispatchSaveCommand()).toBe(true);

    store.unregisterActiveSaveHandler(first);
    expect(store.dispatchSaveCommand()).toBe(false);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });

  it('keeps exactly one active handler at a time', () => {
    const store = useSaveCommandStore();
    const first = vi.fn();
    const second = vi.fn();
    store.registerActiveSaveHandler(first);
    store.registerActiveSaveHandler(second);
    store.dispatchSaveCommand();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
