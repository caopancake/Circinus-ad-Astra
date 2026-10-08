import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { openDirectoryTarget, openModFromOverview } from '@/orchestrators/directory-opening.orchestrator';
import {
  captureWorkspaceCloseTarget,
  closeWorkspaceRuntime,
  removeLoadedModRuntime,
} from '@/orchestrators/workspace-lifecycle.orchestrator';
import { restorePersistedWorkspace } from '@/orchestrators/workspace-persistence.orchestrator';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useProjectStore } from '@/stores/project.store';
import type { ProjectManifest } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  openProject: vi.fn(),
  closeProject: vi.fn(async () => {}),
  hydrate: vi.fn(),
  hydrateWithoutActivate: vi.fn(),
  loadPersistedWorkspace: vi.fn(),
  scanDirectoryGameOverview: vi.fn(),
  detectDirectoryTarget: vi.fn(),
}));

vi.mock('@/services/session.service', () => ({
  openProject: mocks.openProject,
  closeProject: mocks.closeProject,
  detectDirectoryTarget: mocks.detectDirectoryTarget,
  scanDirectoryGameOverview: mocks.scanDirectoryGameOverview,
  invalidateCoreCacheForRoot: vi.fn(async () => {}),
}));
vi.mock('@/services/workspace-state.service', () => ({
  loadPersistedWorkspace: mocks.loadPersistedWorkspace,
  savePersistedWorkspace: vi.fn(async () => {}),
}));
vi.mock('@/stores/tables.store', () => ({
  useTablesStore: () => ({ hydrate: mocks.hydrate, hydrateWithoutActivate: mocks.hydrateWithoutActivate, removeModState: vi.fn() }),
}));
vi.mock('@/services/app-feedback-log.service', () => ({ recordLogBestEffort: vi.fn() }));

const modRoot = 'D:/game/mods/demo';

function manifest(sessionId: string): ProjectManifest {
  return {
    baseVersions: [],
    sessionId,
    modRoot,
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: [],
    modInfo: { name: 'Demo' },
    tableSummaries: {} as ProjectManifest['tableSummaries'],
    tableEntitySummaries: {} as ProjectManifest['tableEntitySummaries'],
    entitySummaries: { factions: 0, missions: 0, ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0 },
    warnings: [],
  };
}

function pendingOpen() {
  let resolve!: (loaded: ProjectManifest) => void;
  let reject!: (error: Error) => void;
  mocks.openProject.mockReturnValueOnce(
    new Promise<ProjectManifest>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    }),
  );
  return { resolve, reject };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
});

describe('directory opening lifecycle', () => {
  it('closes a late session after its loading Mod is removed', async () => {
    const pending = pendingOpen();
    const opening = openModFromOverview(modRoot);
    await removeLoadedModRuntime(modRoot);
    pending.resolve(manifest('stale'));
    await expect(opening).resolves.toEqual({ type: 'cancelled', modRoot });
    expect(mocks.closeProject).toHaveBeenCalledWith('stale');
    expect(useProjectStore().getManifest(modRoot)).toBeNull();
    expect(useWorkspaceStore().isModImported(modRoot)).toBe(false);
    expect(mocks.hydrate).not.toHaveBeenCalled();
    expect(mocks.hydrateWithoutActivate).not.toHaveBeenCalled();
  });

  it('cancels a directory detection that finishes after workspace close', async () => {
    let resolveDetection!: (result: unknown) => void;
    mocks.detectDirectoryTarget.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveDetection = resolve;
      }),
    );
    const opening = openDirectoryTarget(modRoot, null);
    await closeWorkspaceRuntime(captureWorkspaceCloseTarget());
    resolveDetection({ kind: 'unknown', modRoot: null, starsectorRoot: null, overview: null, warnings: [] });
    await expect(opening).resolves.toEqual({ type: 'cancelled', modRoot });
  });

  it('keeps the new opening when the previous request succeeds later', async () => {
    const pending = pendingOpen();
    const oldOpening = openModFromOverview(modRoot);
    await removeLoadedModRuntime(modRoot);
    mocks.openProject.mockResolvedValueOnce(manifest('current'));
    await openModFromOverview(modRoot);
    pending.resolve(manifest('stale'));
    await oldOpening;
    expect(useProjectStore().getSessionId(modRoot)).toBe('current');
    expect(useWorkspaceStore().mods.get(modRoot)?.status).toBe('ready');
    expect(mocks.closeProject).toHaveBeenCalledExactlyOnceWith('stale');
    expect(mocks.hydrate).toHaveBeenCalledTimes(1);
  });

  it('keeps the new opening when the previous request fails later', async () => {
    const pending = pendingOpen();
    const oldOpening = openModFromOverview(modRoot);
    await removeLoadedModRuntime(modRoot);
    mocks.openProject.mockResolvedValueOnce(manifest('current'));
    await openModFromOverview(modRoot);
    pending.reject(new Error('old opening failed'));
    await expect(oldOpening).resolves.toEqual({ type: 'cancelled', modRoot });
    expect(useProjectStore().getSessionId(modRoot)).toBe('current');
    expect(useWorkspaceStore().hasModOpeningFailures).toBe(false);
  });

  it('closes every late session after the captured workspace is closed', async () => {
    const pending = pendingOpen();
    const opening = openModFromOverview(modRoot);
    await closeWorkspaceRuntime(captureWorkspaceCloseTarget());
    pending.resolve(manifest('stale'));
    await opening;
    expect(useWorkspaceStore().hasLoadedMods).toBe(false);
    expect(useProjectStore().manifests.size).toBe(0);
    expect(mocks.closeProject).toHaveBeenCalledWith('stale');
  });

  it('cancels restored targets removed before their session responses arrive', async () => {
    mocks.loadPersistedWorkspace.mockResolvedValue({
      mods: [
        { modRoot, displayName: 'Demo', version: '' },
        { modRoot: 'D:/game/mods/queued', displayName: 'Queued', version: '' },
      ],
      starsectorRoot: null,
      columnWidths: {},
    });
    const pending = pendingOpen();
    const restoring = restorePersistedWorkspace({ knownStarsectorRoot: null, onModRestoreError: vi.fn() });
    await vi.waitFor(() => expect(mocks.openProject).toHaveBeenCalledTimes(1));
    await closeWorkspaceRuntime(captureWorkspaceCloseTarget());
    pending.resolve(manifest('restored-stale'));
    await restoring;
    expect(useProjectStore().manifests.size).toBe(0);
    expect(mocks.hydrateWithoutActivate).not.toHaveBeenCalled();
    expect(mocks.closeProject).toHaveBeenCalledWith('restored-stale');
    expect(mocks.openProject).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore().loadedModCount).toBe(0);
  });

  it('keeps the game overview closed when its restore scan completes later', async () => {
    const starsectorRoot = 'D:/game';
    mocks.loadPersistedWorkspace.mockResolvedValue({
      mods: [{ modRoot, displayName: 'Demo', version: '' }],
      starsectorRoot,
      gameMods: [],
      gameWarnings: [],
      columnWidths: {},
    });
    let resolveScan!: (overview: unknown) => void;
    mocks.scanDirectoryGameOverview.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveScan = resolve;
      }),
    );
    const restoring = restorePersistedWorkspace({ knownStarsectorRoot: null, onModRestoreError: vi.fn() });
    await vi.waitFor(() => expect(mocks.scanDirectoryGameOverview).toHaveBeenCalledTimes(1));
    await closeWorkspaceRuntime(captureWorkspaceCloseTarget());
    resolveScan({ starsectorRoot, mods: [], warnings: [] });
    await restoring;
    expect(useWorkspaceStore().gameOverview).toBeNull();
    expect(mocks.openProject).not.toHaveBeenCalled();
  });
});
