import { createPinia, setActivePinia } from 'pinia';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  saveSettings: vi.fn(),
  emitWindowEvent: vi.fn(async () => {}),
  listenWindowEvent: vi.fn(async (...args: unknown[]) => {
    void args;
    return async () => {};
  }),
}));

vi.mock('@/services/app-settings.service', () => ({
  saveSettings: mocks.saveSettings,
}));

vi.mock('@/windows/tauri.events', () => ({
  emitWindowEvent: mocks.emitWindowEvent,
  listenWindowEvent: mocks.listenWindowEvent,
}));

import { saveLogDirectory, startSettingsMirror, startSettingsPersistence } from './settings-persistence.orchestrator';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { useFileHistoryStore } from '@/stores/file-history.store';

const BASE_SETTINGS = {
  theme: 'light',
  accent: 'blue',
  customAccent: '#3388cc',
  historyLimit: 20,
  editMode: 'smart',
  preserveOriginalJson: true,
  starsectorRoot: null,
  logDirectory: null,
  logLevel: 'info',
} as const;

function settingsFixture(overrides: { theme?: 'light' | 'dark'; historyLimit?: number; preserveOriginalJson?: boolean } = {}) {
  return { ...BASE_SETTINGS, ...overrides };
}

function emptyChange(path: string) {
  return {
    kind: 'file' as const,
    path,
    beforeExists: true,
    beforeText: null,
    beforeDataBase64: null,
    beforeFiles: [],
    afterExists: true,
    afterText: null,
    afterDataBase64: null,
    afterFiles: [],
  };
}

describe('settings persistence orchestration', () => {
  beforeAll(() => {
    setActivePinia(createPinia());
    initializeSettingsStore(settingsFixture());
    startSettingsPersistence();
  });

  beforeEach(() => {
    mocks.saveSettings.mockReset();
    mocks.saveSettings.mockImplementation(async (snapshot: typeof BASE_SETTINGS) => snapshot);
    mocks.emitWindowEvent.mockClear();
    mocks.listenWindowEvent.mockClear();
  });

  it('persists snapshot changes and broadcasts them', async () => {
    const { nextTick } = await import('vue');
    const settings = useSettingsStore();

    settings.setTheme('dark');
    await nextTick();
    await vi.waitFor(() => expect(mocks.saveSettings).toHaveBeenCalled());
    expect(mocks.saveSettings.mock.calls.at(-1)![0]).toMatchObject({ theme: 'dark' });
    await vi.waitFor(() =>
      expect(mocks.emitWindowEvent).toHaveBeenCalledWith('app-settings-changed', expect.objectContaining({ theme: 'dark' })),
    );
  });

  it('persists the JSON preservation switch and mirrors it', async () => {
    const { nextTick } = await import('vue');
    const settings = useSettingsStore();
    settings.setPreserveOriginalJson(false);
    await nextTick();
    await vi.waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ preserveOriginalJson: false })));
    expect(settings.settingsSnapshot().preserveOriginalJson).toBe(false);
    settings.setPreserveOriginalJson(true);
    await nextTick();
  });

  it('syncs the history limit into the file history store', async () => {
    const { nextTick } = await import('vue');
    const settings = useSettingsStore();
    const fileHistory = useFileHistoryStore();

    settings.setHistoryLimit(2);
    await nextTick();
    await vi.waitFor(() => expect(mocks.saveSettings).toHaveBeenCalled());

    // Stacks created after the change inherit the configured limit directly.
    fileHistory.pushSavedWriteEntry('C:/mods/alpha', [emptyChange('a')], 'one');
    fileHistory.pushSavedWriteEntry('C:/mods/alpha', [emptyChange('b')], 'two');
    fileHistory.pushSavedWriteEntry('C:/mods/alpha', [emptyChange('c')], 'three');
    const stacks = fileHistory.getHistoryStacks('C:/mods/alpha');
    expect(stacks.undoStack.map((entry) => entry.label)).toEqual(['one', 'two', 'three'].slice(-2));
  });

  it('saves a picked log directory and rebroadcasts the settings', async () => {
    const settings = useSettingsStore();
    mocks.saveSettings.mockImplementation(async (snapshot: typeof BASE_SETTINGS) => ({ ...snapshot, logDirectory: 'C:/custom-log' }));

    await saveLogDirectory('C:/custom-log');
    expect(settings.logDirectory).toBe('C:/custom-log');
    expect(mocks.emitWindowEvent).toHaveBeenCalledWith('app-settings-changed', expect.objectContaining({ logDirectory: 'C:/custom-log' }));
  });

  it('mirrors settings snapshots received from other windows', async () => {
    const settings = useSettingsStore();
    let mirrorHandler: ((snapshot: unknown) => void) | null = null;
    mocks.listenWindowEvent.mockImplementation(async (_event: unknown, handler: unknown) => {
      mirrorHandler = handler as (snapshot: unknown) => void;
      return async () => {};
    });

    const dispose = startSettingsMirror();
    await vi.waitFor(() => expect(mirrorHandler).not.toBeNull());
    mirrorHandler!(settingsFixture({ theme: 'dark', historyLimit: 3, preserveOriginalJson: false }));

    expect(settings.theme).toBe('dark');
    expect(settings.preserveOriginalJson).toBe(false);
    settings.setPreserveOriginalJson(true);
    dispose();
  });

  it('returns a noop dispose for an already-started persistence watcher', async () => {
    const { nextTick } = await import('vue');
    const noop = startSettingsPersistence();
    expect(typeof noop).toBe('function');

    noop();
    const settings = useSettingsStore();
    settings.setTheme('light');
    await nextTick();
    await vi.waitFor(() => expect(mocks.saveSettings).toHaveBeenCalled());
  });
});
