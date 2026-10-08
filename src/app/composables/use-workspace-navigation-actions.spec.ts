import { createPinia, setActivePinia } from 'pinia';
import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  feedback: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  },
  navigation: {
    navigateToModOverview: vi.fn(),
    navigateToModTable: vi.fn(),
    navigateToModConfig: vi.fn(),
    activateModTab: vi.fn(),
  },
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

vi.mock('@/orchestrators/workspace-navigation.orchestrator', () => ({
  navigateToModOverview: mocks.navigation.navigateToModOverview,
  navigateToModTable: mocks.navigation.navigateToModTable,
  navigateToModConfig: mocks.navigation.navigateToModConfig,
  activateModTab: mocks.navigation.activateModTab,
}));

import { useWorkspaceNavigationActions } from './use-workspace-navigation-actions';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { ref } from 'vue';
import { useTablesStore } from '@/stores/tables.store';
import type { ProjectManifest } from '@/shared/types';
import { TABLE_KEYS } from '@/shared/types';
import { useSaveCommandStore } from '@/stores/save-command.store';

describe('useWorkspaceNavigationActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('navigates to a mod overview through the orchestrator', () => {
    const actions = useWorkspaceNavigationActions();
    actions.navigateToModOverview('C:/mods/alpha');
    expect(mocks.navigation.navigateToModOverview).toHaveBeenCalledWith('C:/mods/alpha');
  });

  it.each([true, false])('waits for save outcome %s and uses the latest navigation intent', async (saved) => {
    const saving = ref(true);
    let release!: (saved: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    useSaveCommandStore().registerSaveSession({ targetKey: ref('one'), modRoot: ref('M:/A'), saving, waitForSave: () => promise });
    const actions = useWorkspaceNavigationActions();
    actions.navigateToModTable('M:/B', 'ships');
    actions.navigateToModTable('M:/C', 'weapons');
    expect(mocks.navigation.navigateToModTable).not.toHaveBeenCalled();
    saving.value = false;
    release(saved);
    await promise;
    await flushPromises();
    if (saved) expect(mocks.navigation.navigateToModTable).toHaveBeenCalledExactlyOnceWith('M:/C', 'weapons');
    else expect(mocks.navigation.navigateToModTable).not.toHaveBeenCalled();
  });

  it('navigates to tables and mod tabs', () => {
    const actions = useWorkspaceNavigationActions();
    actions.navigateToModTable('C:/mods/alpha', 'ships');
    actions.activateModTab('C:/mods/alpha');
    expect(mocks.navigation.navigateToModTable).toHaveBeenCalledWith('C:/mods/alpha', 'ships');
    expect(mocks.navigation.activateModTab).toHaveBeenCalledWith('C:/mods/alpha');
  });

  it('switches config views through the orchestrator', () => {
    const workspace = useWorkspaceStore();
    workspace.registerMod({ modRoot: 'C:/mods/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    workspace.activateModTab('C:/mods/alpha');
    const actions = useWorkspaceNavigationActions();
    actions.navigateToModConfig('C:/mods/alpha', 'factions');
    expect(mocks.navigation.navigateToModConfig).toHaveBeenCalledWith('C:/mods/alpha', 'factions');
  });

  it('skips the confirmation and orchestrator when the target config view is already active', () => {
    const workspace = useWorkspaceStore();
    workspace.registerMod({ modRoot: 'C:/mods/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    workspace.activateModConfig('C:/mods/alpha', 'factions');
    const actions = useWorkspaceNavigationActions();
    actions.navigateToModConfig('C:/mods/alpha', 'factions');
    expect(mocks.navigation.navigateToModConfig).not.toHaveBeenCalled();
  });

  it('skips tab activation when the requested tab is already active', () => {
    const workspace = useWorkspaceStore();
    workspace.registerMod({ modRoot: 'C:/mods/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    workspace.activateModTab('C:/mods/alpha');
    const actions = useWorkspaceNavigationActions();
    actions.activateModTab('C:/mods/alpha');
    expect(mocks.navigation.activateModTab).not.toHaveBeenCalled();
  });

  it('switches to the overview/settings/about surfaces without a mod context', () => {
    const actions = useWorkspaceNavigationActions();
    actions.showOverview();
    actions.showSettings();
    actions.showAbout();
    const workspace = useWorkspaceStore();
    expect(workspace.currentView).toBe('about');
  });

  it('confirms before navigating when the active mod has dirty drafts', () => {
    const workspace = useWorkspaceStore();
    workspace.registerMod({ modRoot: 'C:/mods/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    workspace.activateModTab('C:/mods/alpha');
    const draftSessions = useDraftSessionsStore();
    draftSessions.registerDraftSession(ref('C:/mods/alpha'), ref(true));
    const actions = useWorkspaceNavigationActions();
    actions.navigateToModOverview('C:/mods/alpha');
    expect(mocks.navigation.navigateToModOverview).not.toHaveBeenCalled();
    expect(mocks.feedback.confirmWarning).toHaveBeenCalledTimes(1);
    mocks.feedback.confirmWarning.mock.calls[0]![0].onConfirm();
    expect(mocks.navigation.navigateToModOverview).toHaveBeenCalledWith('C:/mods/alpha');
  });

  it('commits the departing table input before changing the workspace target', async () => {
    const workspace = useWorkspaceStore();
    const tables = useTablesStore();
    const root = 'M:/A';
    workspace.registerMod({ modRoot: root, displayName: 'A', version: '', status: 'ready' });
    tables.hydrate(root, {
      modRoot: root,
      baseVersions: [],
      starsectorRoot: null,
      coreAvailable: false,
      associatedSpecTables: [],
      modInfo: {},
      tableEntitySummaries: Object.fromEntries(TABLE_KEYS.map((table) => [table, 0])) as ProjectManifest['tableEntitySummaries'],
      entitySummaries: { factions: 0, missions: 0, ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0 },
      warnings: [],
      sessionId: 'sA',
      tableSummaries: Object.fromEntries(
        TABLE_KEYS.map((table) => [table, { path: `${table}.csv`, available: table === 'ships', header: ['id'], totalRows: 0 }]),
      ) as ProjectManifest['tableSummaries'],
    });
    workspace.activateModTable(root);
    const dirty = ref(true);
    tables.getTableInputs(root, 'ships').register({
      key: 'row/field',
      label: 'Field',
      dirty,
      commit: () => {
        expect(mocks.navigation.navigateToModTable).not.toHaveBeenCalled();
        dirty.value = false;
        return null;
      },
      focus: vi.fn(),
      cancel: vi.fn(),
    });
    useWorkspaceNavigationActions().navigateToModTable('M:/B', 'weapons');
    await vi.waitFor(() => expect(mocks.navigation.navigateToModTable).toHaveBeenCalledWith('M:/B', 'weapons'));
    expect(dirty.value).toBe(false);
  });
});
