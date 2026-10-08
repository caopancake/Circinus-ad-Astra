import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveredField } from '@/domain/schema/schema.types';

const mocks = vi.hoisted(() => ({
  queryCoreFields: vi.fn(),
  queryCoreGraphics: vi.fn(async (root: string) => {
    void root;
    return [] as string[];
  }),
}));

vi.mock('@/services/assets.service', () => ({
  queryCoreFields: mocks.queryCoreFields,
  queryCoreGraphics: mocks.queryCoreGraphics,
}));

vi.mock('@/services/app-feedback-log.service', () => ({
  recordLogBestEffort: vi.fn(),
}));

import { useCoreAssetsStore, useCoreGraphics, useCoreSchema } from './use-core-assets';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { useProjectStore } from '@/stores/project.store';

const FIELDS: Record<string, DiscoveredField[]> = {
  faction: [{ key: 'bonus', type: 'string', origin: 'core' }],
};

function settingsFixture(starsectorRoot: string | null) {
  return {
    theme: 'light',
    accent: 'blue',
    customAccent: '#3388cc',
    historyLimit: 20,
    editMode: 'smart',
    starsectorRoot,
    logDirectory: null,
    logLevel: 'info',
  } as const;
}

describe('useCoreAssetsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore(settingsFixture(null));
    vi.clearAllMocks();
  });

  it('keeps facades reactive across first load and game root changes', async () => {
    initializeSettingsStore(settingsFixture('D:/first'));
    mocks.queryCoreFields.mockResolvedValue(FIELDS);
    mocks.queryCoreGraphics.mockImplementation(async (root) => [`${root}/graphics/sprite.png`]);
    const facade = useCoreGraphics();
    expect(facade.graphicsPaths.value).toEqual([]);
    await facade.loadGraphics();
    expect(facade.graphicsPaths.value).toEqual(['D:/first/graphics/sprite.png']);
    useSettingsStore().setStarsectorRoot('E:/second');
    await vi.waitFor(() => expect(facade.graphicsPaths.value).toEqual(['E:/second/graphics/sprite.png']));
    expect(facade.starsectorRoot.value).toBe('E:/second');
  });

  it('loads core fields for the current root and marks them loaded', async () => {
    initializeSettingsStore(settingsFixture('D:/games/starsector'));
    mocks.queryCoreFields.mockResolvedValue(FIELDS);
    const store = useCoreAssetsStore();

    await store.loadFieldsFor('D:/games/starsector');
    expect(store.coreFieldsLoaded).toBe(true);
    expect(store.coreFieldsLoading).toBe(false);
    expect(store.getMergedSchema('faction')?.sections?.at(-1)?.id).toBe('__core_discovered');
  });

  it('returns the plain schema for ids without discovered fields', async () => {
    initializeSettingsStore(settingsFixture('D:/games/starsector'));
    mocks.queryCoreFields.mockResolvedValue(FIELDS);
    const store = useCoreAssetsStore();
    await store.loadFieldsFor('D:/games/starsector');
    expect(store.getMergedSchema('mod-info')).not.toBeNull();
    expect(store.getMergedSchema('unknown-id')).toBeNull();
  });

  it('resets and reloads when the root changes, keeping only the current root result', async () => {
    initializeSettingsStore(settingsFixture('D:/games/starsector'));
    let resolveSecond: (value: Record<string, DiscoveredField[]>) => void = () => {};
    mocks.queryCoreFields.mockResolvedValueOnce({ faction: [{ key: 'old', type: 'string' }] }).mockImplementationOnce(
      () =>
        new Promise<Record<string, DiscoveredField[]>>((resolve) => {
          resolveSecond = resolve;
        }),
    );
    const store = useCoreAssetsStore();
    await store.loadFieldsFor('D:/games/starsector');
    expect(store.coreFieldsLoaded).toBe(true);
    expect(store.getMergedSchema('faction')?.sections?.at(-1)?.fields[0]?.label).toBe('old');

    const secondLoad = store.loadFieldsFor('E:/other-root');
    await vi.waitFor(() => expect(store.coreFieldsLoading).toBe(true));
    resolveSecond({ faction: [{ key: 'new', type: 'string', origin: 'core' }] });
    await secondLoad;
    // The stale E:/ result is discarded and the store chases the current root.
    await vi.waitFor(() => expect(store.coreFields.faction?.[0]?.key).toBe('bonus'));
    expect(store.getMergedSchema('faction')?.sections?.at(-1)?.fields[0]?.label).toBe('bonus');
  });

  it('clears loaded fields when the scan fails', async () => {
    initializeSettingsStore(settingsFixture('D:/games/starsector'));
    mocks.queryCoreFields.mockRejectedValue(new Error('scan failed'));
    const store = useCoreAssetsStore();
    await store.loadFieldsFor('D:/games/starsector');
    expect(store.coreFieldsLoaded).toBe(false);
    expect(store.coreFieldsLoading).toBe(false);
  });

  it('resets fields without a root', async () => {
    mocks.queryCoreFields.mockResolvedValue(FIELDS);
    const store = useCoreAssetsStore();
    await store.loadFieldsFor(null);
    expect(store.coreFieldsLoaded).toBe(false);
    expect(mocks.queryCoreFields).not.toHaveBeenCalled();
  });

  it('loads graphics paths and exposes facade accessors', async () => {
    initializeSettingsStore(settingsFixture('D:/games/starsector'));
    mocks.queryCoreGraphics.mockResolvedValue(['graphics/ship.png']);
    useProjectStore();
    const store = useCoreAssetsStore();
    await store.loadGraphicsFor('D:/games/starsector');
    expect(store.graphicsPaths).toEqual(['graphics/ship.png']);
    expect(store.graphicsLoaded).toBe(true);

    const facade = useCoreGraphics();
    expect(facade.graphicsPaths.value).toEqual(['graphics/ship.png']);
    expect(facade.loaded.value).toBe(true);
  });

  it('exposes the schema facade with merged schema access', async () => {
    initializeSettingsStore(settingsFixture('D:/games/starsector'));
    mocks.queryCoreFields.mockResolvedValue(FIELDS);
    const store = useCoreAssetsStore();
    await store.loadFieldsFor('D:/games/starsector');

    const facade = useCoreSchema();
    expect(facade.loaded.value).toBe(true);
    expect(facade.starsectorRoot.value).toBe('D:/games/starsector');
    expect(facade.getMergedSchema('faction')?.sections?.at(-1)?.fields[0]?.label).toBe('bonus');
    await facade.loadCoreFields();
  });
});
