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
  replayNextFileUndo: vi.fn(),
  replayNextFileRedo: vi.fn(),
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

vi.mock('@/orchestrators/file-history-replay.orchestrator', () => ({
  replayNextFileUndo: mocks.replayNextFileUndo,
  replayNextFileRedo: mocks.replayNextFileRedo,
}));

import { useFileHistoryViewModel } from './use-file-history-view-model';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { ProjectManifest } from '@/shared/types';

function manifestFixture(modRoot: string): ProjectManifest {
  return {
    sessionId: 's1',
    modRoot,
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: [],
    modInfo: { name: 'Alpha' },
    tableSummaries: {} as ProjectManifest['tableSummaries'],
    tableEntitySummaries: {} as ProjectManifest['tableEntitySummaries'],
    entitySummaries: { factions: 0, missions: 0, ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0 },
    warnings: [],
  };
}

describe('useFileHistoryViewModel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('falls back to the unselected-mod title', () => {
    const viewModel = useFileHistoryViewModel();
    expect(viewModel.modTitle.value).toBe('未选择 Mod');
    expect(viewModel.historyCount.value).toBe(0);
    expect(viewModel.canUndo.value).toBe(false);
    expect(viewModel.canRedo.value).toBe(false);
  });

  it('exposes the mod title from the active manifest', () => {
    const workspace = useWorkspaceStore();
    const project = useProjectStore();
    workspace.registerMod({ modRoot: 'C:/mods/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    workspace.activateModTab('C:/mods/alpha');
    project.registerProjectManifest(manifestFixture('C:/mods/alpha'));
    const viewModel = useFileHistoryViewModel();
    expect(viewModel.modTitle.value).toBe('Alpha');
  });

  it('lists undo and redo entries newest first with counts', () => {
    const workspace = useWorkspaceStore();
    const project = useProjectStore();
    workspace.registerMod({ modRoot: 'C:/mods/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    workspace.activateModTab('C:/mods/alpha');
    project.registerProjectManifest(manifestFixture('C:/mods/alpha'));
    const fileHistory = useFileHistoryStore();
    fileHistory.pushSavedWriteEntry('C:/mods/alpha', [changeRecord('a')], 'save one');
    fileHistory.pushSavedWriteEntry('C:/mods/alpha', [changeRecord('b')], 'save two');
    const viewModel = useFileHistoryViewModel();
    expect(viewModel.historyCount.value).toBe(2);
    expect(viewModel.undoDisplayItems.value.map((entry) => entry.label)).toEqual(['save two', 'save one']);
    expect(viewModel.redoDisplayItems.value).toEqual([]);
    expect(viewModel.canUndo.value).toBe(true);
    expect(viewModel.canRedo.value).toBe(false);
  });

  it('clears the active mod stacks behind a confirmation', () => {
    const workspace = useWorkspaceStore();
    const project = useProjectStore();
    workspace.registerMod({ modRoot: 'C:/mods/alpha', displayName: 'Alpha', version: '', status: 'ready' });
    workspace.activateModTab('C:/mods/alpha');
    project.registerProjectManifest(manifestFixture('C:/mods/alpha'));
    const fileHistory = useFileHistoryStore();
    fileHistory.pushSavedWriteEntry('C:/mods/alpha', [changeRecord('a')], 'save one');
    const viewModel = useFileHistoryViewModel();
    viewModel.confirmClear();
    expect(mocks.feedback.confirmWarning).toHaveBeenCalledTimes(1);
    mocks.feedback.confirmWarning.mock.calls[0]![0].onConfirm();
    expect(fileHistory.getHistoryStacks('C:/mods/alpha').undoStack).toHaveLength(0);
    expect(mocks.feedback.success).toHaveBeenCalledWith('文件历史已清空');
  });

  it('skips clearing when there is no active mod or nothing to clear', () => {
    const viewModel = useFileHistoryViewModel();
    viewModel.confirmClear();
    expect(mocks.feedback.confirmWarning).not.toHaveBeenCalled();
  });

  it('delegates undo and redo to the replay orchestrators', () => {
    const viewModel = useFileHistoryViewModel();
    viewModel.undoOne();
    viewModel.redoOne();
    expect(mocks.replayNextFileUndo).toHaveBeenCalledTimes(1);
    expect(mocks.replayNextFileRedo).toHaveBeenCalledTimes(1);
  });
});

function changeRecord(path: string) {
  return {
    kind: 'file' as const,
    path,
    beforeExists: true,
    beforeText: 'before',
    beforeDataBase64: null,
    beforeFiles: [],
    afterExists: true,
    afterText: 'after',
    afterDataBase64: null,
    afterFiles: [],
  };
}
