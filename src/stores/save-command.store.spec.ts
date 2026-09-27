import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSaveCommandStore } from './save-command.store';

describe('useSaveCommandStore', () => {
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
