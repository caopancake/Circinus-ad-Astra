import { createPinia, setActivePinia } from 'pinia';
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
});
