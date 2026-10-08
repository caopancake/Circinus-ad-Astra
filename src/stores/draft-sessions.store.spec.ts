import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { computed, ref } from 'vue';
import { useDraftSessionsStore } from './draft-sessions.store';

beforeEach(() => setActivePinia(createPinia()));

describe('reactive unsaved work registry', () => {
  it('updates an already evaluated close guard when a new editing surface mounts', () => {
    const registry = useDraftSessionsStore();
    const closeDirty = computed(() => registry.hasUnsavedWorkForMod('M:/A'));
    expect(closeDirty.value).toBe(false);
    const dirty = ref(false);
    const unregister = registry.registerDraftSession(ref('M:/A'), dirty);
    dirty.value = true;
    expect(closeDirty.value).toBe(true);
    unregister();
    expect(closeDirty.value).toBe(false);
  });

  it('tracks late CSV input sources and isolates Mod ownership', () => {
    const registry = useDraftSessionsStore();
    const closeDirty = computed(() => registry.hasUnsavedWorkForMod('M:/A'));
    const pending = ref(false);
    expect(closeDirty.value).toBe(false);
    const unregister = registry.registerDirtySource((modRoot) => modRoot === 'M:/A' && pending.value);
    pending.value = true;
    expect(closeDirty.value).toBe(true);
    expect(registry.hasUnsavedWorkForMod('M:/B')).toBe(false);
    unregister();
    expect(closeDirty.value).toBe(false);
  });
});
