import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  interface MockWorkspaceStore {
    activeModRoot: string | null;
    currentView: string;
    gameOverview: { starsectorRoot: string };
    mods: Map<string, unknown>;
    activateModOverview: ReturnType<typeof vi.fn>;
    clearModOpeningFailure: ReturnType<typeof vi.fn>;
    clearModOpeningFailures: ReturnType<typeof vi.fn>;
    isModImported: ReturnType<typeof vi.fn>;
    registerMod: ReturnType<typeof vi.fn>;
    getModGeneration: ReturnType<typeof vi.fn>;
    getWorkspaceGeneration: ReturnType<typeof vi.fn>;
    removeLoadedModEntry: ReturnType<typeof vi.fn>;
    setModOpeningFailure: ReturnType<typeof vi.fn>;
    showOverview: ReturnType<typeof vi.fn>;
    updateModInfo: ReturnType<typeof vi.fn>;
    updateModStatus: ReturnType<typeof vi.fn>;
    revokeWorkspaceGeneration: ReturnType<typeof vi.fn>;
  }

  const workspaceStore: MockWorkspaceStore = {
    activeModRoot: null,
    currentView: 'overview',
    gameOverview: { starsectorRoot: 'D:\\game' },
    mods: new Map<string, unknown>(),
    activateModOverview: vi.fn((modRoot: string) => {
      workspaceStore.activeModRoot = modRoot;
      workspaceStore.currentView = 'config';
    }),
    clearModOpeningFailure: vi.fn(),
    clearModOpeningFailures: vi.fn(),
    isModImported: vi.fn(() => false),
    registerMod: vi.fn((entry: { modRoot: string }) => {
      workspaceStore.mods.set(entry.modRoot, entry);
      return 1;
    }),
    getModGeneration: vi.fn((modRoot: string) => (workspaceStore.mods.has(modRoot) ? 1 : null)),
    getWorkspaceGeneration: vi.fn(() => 0),
    removeLoadedModEntry: vi.fn(),
    setModOpeningFailure: vi.fn(),
    showOverview: vi.fn(() => {
      workspaceStore.currentView = 'overview';
    }),
    updateModInfo: vi.fn(),
    updateModStatus: vi.fn(),
    revokeWorkspaceGeneration: vi.fn(),
  };
  return {
    workspaceStore,
    project: {
      registerProjectManifest: vi.fn(),
      getSessionId: vi.fn(() => null),
      removeProjectManifest: vi.fn(),
      setActiveModRoot: vi.fn(),
      setLoading: vi.fn(),
    },
    tables: { hydrate: vi.fn(), hydrateWithoutActivate: vi.fn(), removeModState: vi.fn() },
    fileHistory: { activateFor: vi.fn(), removeModState: vi.fn() },
    csvHistory: { clearForMod: vi.fn() },
    writeSync: { pending: [], removeModState: vi.fn() },
    openProject: vi.fn(),
    closeProject: vi.fn(async () => {}),
  };
});

vi.mock('@/stores/workspace.store', () => ({ useWorkspaceStore: () => mocks.workspaceStore }));
vi.mock('@/stores/project.store', () => ({ useProjectStore: () => mocks.project }));
vi.mock('@/stores/tables.store', () => ({ useTablesStore: () => mocks.tables }));
vi.mock('@/stores/file-history.store', () => ({ useFileHistoryStore: () => mocks.fileHistory }));
vi.mock('@/stores/tables-edit-history.store', () => ({ useTablesEditHistoryStore: () => mocks.csvHistory }));
vi.mock('@/stores/write-sync.store', () => ({ useWriteSyncStore: () => mocks.writeSync }));
vi.mock('@/services/session.service', () => ({
  detectDirectoryTarget: vi.fn(),
  openProject: mocks.openProject,
  closeProject: mocks.closeProject,
  scanDirectoryGameOverview: vi.fn(),
}));
vi.mock('@/domain/project/load-warnings', () => ({ formatLoadWarnings: () => [] }));
vi.mock('@/services/app-feedback-log.service', () => ({ recordLogBestEffort: vi.fn() }));
vi.mock('@/shared/runtime/performance', () => ({
  measurePerformance: (_name: string, _detail: unknown, action: () => unknown) => action(),
}));
vi.mock('@/orchestrators/workspace-navigation.orchestrator', () => ({ navigateToModOverview: vi.fn() }));

import { openModFromOverview } from '@/orchestrators/directory-opening.orchestrator';

beforeEach(() => {
  mocks.workspaceStore.activeModRoot = null;
  mocks.workspaceStore.currentView = 'overview';
  mocks.workspaceStore.mods.clear();
  mocks.workspaceStore.isModImported.mockReturnValue(false);
  mocks.workspaceStore.removeLoadedModEntry.mockImplementation((modRoot: string) => mocks.workspaceStore.mods.delete(modRoot));
  mocks.openProject.mockResolvedValue({ modInfo: { name: 'Demo' } });
});

describe('workspace Mod opening navigation', () => {
  it('enters the opened Mod overview after its ProjectSession loads', async () => {
    const modRoot = 'D:\\game\\mods\\demo';

    const outcome = await openModFromOverview(modRoot);

    expect(outcome).toEqual({ type: 'mod-loaded', modRoot, modName: 'Demo', warnings: [] });
    expect(mocks.workspaceStore.activeModRoot).toBe(modRoot);
    expect(mocks.workspaceStore.currentView).toBe('config');
    expect(mocks.workspaceStore.clearModOpeningFailure).toHaveBeenCalledWith(modRoot);
  });

  it('records a structured runtime failure after rolling back the Mod', async () => {
    const modRoot = '\\\\?\\D:\\game\\mods\\demo';
    mocks.openProject.mockRejectedValue(
      new Error('解析 CSV 失败 (D:\\game\\mods\\demo\\data\\hulls\\ship_data.csv): record starts at line 5'),
    );

    await expect(openModFromOverview(modRoot)).rejects.toThrow('解析 CSV 失败');

    expect(mocks.workspaceStore.removeLoadedModEntry).toHaveBeenCalledWith(modRoot);
    expect(mocks.workspaceStore.setModOpeningFailure).toHaveBeenCalledWith({
      modRoot,
      message: expect.stringContaining('解析 CSV 失败'),
      file: {
        path: 'D:\\game\\mods\\demo\\data\\hulls\\ship_data.csv',
        line: 5,
        column: undefined,
      },
    });
    expect(mocks.workspaceStore.currentView).toBe('overview');
  });
});
