import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectManifest } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  loadPersistedWorkspace: vi.fn(),
  savePersistedWorkspace: vi.fn(async () => {}),
  scanDirectoryGameOverview: vi.fn(),
  openModProjectManifest: vi.fn(),
  hydrateOpenedModRuntime: vi.fn(),
}));

vi.mock('@/services/workspace-state.service', () => ({
  loadPersistedWorkspace: mocks.loadPersistedWorkspace,
  savePersistedWorkspace: mocks.savePersistedWorkspace,
}));

vi.mock('@/services/session.service', () => ({
  scanDirectoryGameOverview: mocks.scanDirectoryGameOverview,
}));

vi.mock('@/orchestrators/directory-opening.orchestrator', () => ({
  openModProjectManifest: mocks.openModProjectManifest,
  hydrateOpenedModRuntime: mocks.hydrateOpenedModRuntime,
}));

import { restorePersistedWorkspace, watchWorkspacePersistence } from './workspace-persistence.orchestrator';
import { useWorkspaceStore } from '@/stores/workspace.store';

function manifestFixture(modRoot: string): ProjectManifest {
  return {
    sessionId: 's1',
    modRoot,
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: [],
    modInfo: { name: 'Alpha', version: '1.0' },
    tableSummaries: {} as ProjectManifest['tableSummaries'],
    tableEntitySummaries: {} as ProjectManifest['tableEntitySummaries'],
    entitySummaries: { factions: 0, missions: 0, ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0 },
    warnings: [{ path: 'data/x.csv', message: 'scan warning', editTarget: null }],
  };
}

describe('restorePersistedWorkspace', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('returns early for an empty persisted snapshot', async () => {
    mocks.loadPersistedWorkspace.mockResolvedValue({ mods: [], starsectorRoot: null });
    await restorePersistedWorkspace({ knownStarsectorRoot: null, onModRestoreError: vi.fn() });
    expect(mocks.scanDirectoryGameOverview).not.toHaveBeenCalled();
    expect(mocks.openModProjectManifest).not.toHaveBeenCalled();
    expect(mocks.hydrateOpenedModRuntime).not.toHaveBeenCalled();
  });

  it('restores each persisted mod and reports load warnings', async () => {
    const workspace = useWorkspaceStore();
    mocks.loadPersistedWorkspace.mockResolvedValue({
      mods: [{ modRoot: 'C:/mods/alpha', displayName: 'Alpha Folder', version: '0.9' }],
      starsectorRoot: 'D:/games/starsector',
    });
    mocks.scanDirectoryGameOverview.mockResolvedValue({ starsectorRoot: 'D:/games/starsector', mods: [] });
    mocks.openModProjectManifest.mockResolvedValue(manifestFixture('C:/mods/alpha'));
    const onWarnings = vi.fn();
    const onError = vi.fn();

    await restorePersistedWorkspace({ knownStarsectorRoot: null, onModRestoreError: onError, onModRestoreWarnings: onWarnings });
    expect(mocks.openModProjectManifest).toHaveBeenCalledWith('C:/mods/alpha', 'D:/games/starsector');
    expect(mocks.hydrateOpenedModRuntime).toHaveBeenCalledWith('C:/mods/alpha', expect.anything(), false);
    expect(onWarnings).toHaveBeenCalledWith('Alpha', ['scan warning（data/x.csv）']);
    expect(onError).not.toHaveBeenCalled();
    const mod = workspace.mods.get('C:/mods/alpha');
    expect(mod?.displayName).toBe('Alpha');
    expect(mod?.status).toBe('ready');
    expect(workspace.currentView).toBe('overview');
  });

  it('routes restore failures into the error callback', async () => {
    const workspace = useWorkspaceStore();
    mocks.loadPersistedWorkspace.mockResolvedValue({
      mods: [{ modRoot: 'C:/mods/broken', displayName: 'Broken', version: '' }],
      starsectorRoot: null,
    });
    mocks.openModProjectManifest.mockRejectedValue(new Error('broken mod_info'));
    const onError = vi.fn(async () => {});

    await restorePersistedWorkspace({ knownStarsectorRoot: null, onModRestoreError: onError });
    expect(onError).toHaveBeenCalledWith('C:/mods/broken', 'Broken', expect.anything());
    expect(workspace.mods.get('C:/mods/broken')?.status).not.toBe('ready');
  });
});

describe('watchWorkspacePersistence', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces workspace changes into a single save', async () => {
    const workspace = useWorkspaceStore();
    const watcher = watchWorkspacePersistence();
    workspace.registerMod({ modRoot: 'C:/mods/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    workspace.showSettings();
    await vi.advanceTimersByTimeAsync(200);
    workspace.showAbout();
    await vi.advanceTimersByTimeAsync(600);

    expect(mocks.savePersistedWorkspace).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it('suppresses saves while a restore is in progress', async () => {
    const workspace = useWorkspaceStore();
    const watcher = watchWorkspacePersistence();
    watcher.beginRestore();
    workspace.showSettings();
    await vi.advanceTimersByTimeAsync(800);
    expect(mocks.savePersistedWorkspace).not.toHaveBeenCalled();

    await watcher.finishRestore(true);
    expect(mocks.savePersistedWorkspace).toHaveBeenCalledTimes(1);
    watcher.stop();
  });

  it('skips the final save when the restore failed', async () => {
    const watcher = watchWorkspacePersistence();
    await watcher.finishRestore(false);
    expect(mocks.savePersistedWorkspace).not.toHaveBeenCalled();
    watcher.stop();
  });
});
