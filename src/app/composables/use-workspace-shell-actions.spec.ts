import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppFeedback } from '@/shared/types';

type DirectoryOpeningOutcomeLike = Record<string, unknown> & { type: string };

const mocks = vi.hoisted(() => ({
  pickDirectory: vi.fn(),
  scanDirectoryGameOverview: vi.fn(),
  openDirectoryTarget: vi.fn(),
  openModFromOverview: vi.fn(),
  saveActiveTableChanges: vi.fn(),
  captureWorkspaceCloseTarget: vi.fn(),
  closeWorkspaceRuntime: vi.fn(async () => {}),
  removeLoadedModRuntime: vi.fn(async () => {}),
  openEditorWindow: vi.fn(async () => {}),
  openFileEditorWindow: vi.fn(async () => {}),
  recordLogBestEffort: vi.fn(),
}));

vi.mock('@/services/session.service', () => ({
  pickDirectory: mocks.pickDirectory,
  scanDirectoryGameOverview: mocks.scanDirectoryGameOverview,
}));

vi.mock('@/orchestrators/table-save.orchestrator', () => ({
  saveActiveTableChanges: mocks.saveActiveTableChanges,
  pendingTableSave: () => null,
}));

vi.mock('@/orchestrators/directory-opening.orchestrator', () => ({
  openDirectoryTarget: mocks.openDirectoryTarget,
  openModFromOverview: mocks.openModFromOverview,
}));

vi.mock('@/orchestrators/workspace-lifecycle.orchestrator', () => ({
  captureWorkspaceCloseTarget: mocks.captureWorkspaceCloseTarget,
  closeWorkspaceRuntime: mocks.closeWorkspaceRuntime,
  removeLoadedModRuntime: mocks.removeLoadedModRuntime,
}));

vi.mock('@/windows/editor.window', () => ({
  openEditorWindow: mocks.openEditorWindow,
}));

vi.mock('@/windows/file-editor.window', () => ({
  openFileEditorWindow: mocks.openFileEditorWindow,
  openGameWarningFileEditor: vi.fn(() => null),
  openModOpeningFailureFileEditor: vi.fn(() => null),
}));

vi.mock('@/services/app-feedback-log.service', () => ({
  recordLogBestEffort: mocks.recordLogBestEffort,
}));

import { useWorkspaceShellActions } from './use-workspace-shell-actions';
import { initializeSettingsStore } from '@/stores/settings.store';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { ref } from 'vue';

function feedbackStub(): AppFeedback {
  return {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  };
}

describe('useWorkspaceShellActions', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore({
      theme: 'light',
      accent: 'blue',
      customAccent: '#3388cc',
      historyLimit: 20,
      editMode: 'smart',
      starsectorRoot: null,
      logDirectory: null,
      logLevel: 'info',
    });
    vi.clearAllMocks();
  });

  it('opens a directory and reports the game overview outcome', async () => {
    const workspace = useWorkspaceStore();
    workspace.setGameOverview({ starsectorRoot: 'D:/games/starsector', coreAvailable: true, modsDir: 'mods', mods: [], warnings: [] });
    mocks.pickDirectory.mockResolvedValue('D:/games/starsector');
    const outcome: DirectoryOpeningOutcomeLike = { type: 'game-overview', root: 'D:/games/starsector', availableModCount: 3 };
    mocks.openDirectoryTarget.mockResolvedValue(outcome);

    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.openDirectory();

    expect(feedback.success).toHaveBeenCalledWith(expect.stringContaining('3 个 Mod'));
    expect(feedback.error).not.toHaveBeenCalled();
  });

  it('reports unknown directories as an error', async () => {
    mocks.pickDirectory.mockResolvedValue('C:/random');
    mocks.openDirectoryTarget.mockResolvedValue({ type: 'unknown', message: '未识别该目录' });
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.openDirectory();
    expect(feedback.error).toHaveBeenCalledWith('未识别该目录');
  });

  it('reports directory opening failures through feedback', async () => {
    mocks.pickDirectory.mockResolvedValue('C:/broken');
    mocks.openDirectoryTarget.mockRejectedValue(new Error('scan failed'));
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.openDirectory();
    expect(feedback.error).toHaveBeenCalledWith(expect.anything());
  });

  it('skips an empty directory pick', async () => {
    mocks.pickDirectory.mockResolvedValue(null);
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.openDirectory();
    expect(mocks.openDirectoryTarget).not.toHaveBeenCalled();
  });

  it('confirms removing a mod with unsaved changes and removes after confirmation', async () => {
    const draftSessions = useDraftSessionsStore();
    draftSessions.registerDraftSession(ref('M:/mod'), ref(true));
    const feedback = feedbackStub();
    (feedback.choose as ReturnType<typeof vi.fn>).mockResolvedValue('remove');
    const actions = useWorkspaceShellActions(feedback);

    await actions.confirmRemoveMod('M:/mod');
    expect(feedback.choose).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(mocks.removeLoadedModRuntime).toHaveBeenCalledWith('M:/mod'));
    expect(feedback.success).toHaveBeenCalledWith('Mod 已从工作区移除');
  });

  it('removes a clean mod immediately without confirmation', async () => {
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.confirmRemoveMod('M:/clean');
    expect(mocks.removeLoadedModRuntime).toHaveBeenCalledWith('M:/clean');
    expect(feedback.confirmWarning).not.toHaveBeenCalled();
  });

  it('warns about unsaved work when closing the workspace', async () => {
    mocks.captureWorkspaceCloseTarget.mockReturnValue({ modRoots: ['M:/mod'] });
    const draftSessions = useDraftSessionsStore();
    draftSessions.registerDirtySource((modRoot) => modRoot === 'M:/mod');
    const feedback = feedbackStub();
    (feedback.choose as ReturnType<typeof vi.fn>).mockResolvedValue('close');
    const actions = useWorkspaceShellActions(feedback);

    await actions.confirmCloseWorkspace();
    const content = (feedback.choose as ReturnType<typeof vi.fn>).mock.calls[0]![0].content;
    expect(content).toContain('未保存修改');
    await vi.waitFor(() => expect(mocks.closeWorkspaceRuntime).toHaveBeenCalledTimes(1));
    expect(feedback.success).toHaveBeenCalledWith('工作区已关闭');
  });

  it.each([true, false])('coalesces workspace closing while save completes with %s', async (saved) => {
    mocks.captureWorkspaceCloseTarget.mockReturnValue({ modRoots: ['M:/mod'] });
    const saving = ref(true),
      dirty = ref(false);
    let release!: (saved: boolean) => void;
    const promise = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    useSaveCommandStore().registerSaveSession({ targetKey: ref('one'), modRoot: ref('M:/mod'), saving, waitForSave: () => promise });
    useDraftSessionsStore().registerDirtySource(() => dirty.value);
    const feedback = feedbackStub();
    (feedback.choose as ReturnType<typeof vi.fn>).mockResolvedValue('close');
    const actions = useWorkspaceShellActions(feedback);
    const closing = actions.confirmCloseWorkspace();
    expect(actions.confirmCloseWorkspace()).toBe(closing);
    expect(feedback.choose).not.toHaveBeenCalled();
    dirty.value = true;
    saving.value = false;
    release(saved);
    await closing;
    if (saved) {
      expect(feedback.choose).toHaveBeenCalledOnce();
      expect((feedback.choose as ReturnType<typeof vi.fn>).mock.calls[0]![0].content).toContain('未保存修改');
      expect(mocks.closeWorkspaceRuntime).toHaveBeenCalledOnce();
    } else {
      expect(feedback.choose).not.toHaveBeenCalled();
      expect(mocks.closeWorkspaceRuntime).not.toHaveBeenCalled();
    }
  });

  it('skips saving when there is no captured table target', async () => {
    mocks.saveActiveTableChanges.mockResolvedValue('noop');
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.saveChanges();
    expect(mocks.saveActiveTableChanges).toHaveBeenCalledTimes(1);
  });

  it('reports the save result of the active table', async () => {
    mocks.saveActiveTableChanges.mockResolvedValue('saved');
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.saveChanges();
    expect(mocks.saveActiveTableChanges).toHaveBeenCalledWith({ manifest: null, selectAssociatedSpecs: expect.any(Function), feedback });
    expect(feedback.success).toHaveBeenCalledWith('当前 CSV 表已保存');
  });

  it('informs when there is nothing to save', async () => {
    mocks.saveActiveTableChanges.mockResolvedValue('noop');
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.saveChanges();
    expect(feedback.info).toHaveBeenCalledWith('没有需要保存的修改');
  });

  it('reports undo and redo failures for the current table', () => {
    vi.doMock('@/stores/tables.store', () => ({
      useTablesStore: () => ({ undoCurrentTableEdit: () => null, redoCurrentTableEdit: () => null }),
    }));
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    actions.undoCurrentTableEdit();
    actions.redoCurrentTableEdit();
    expect(feedback.error).toHaveBeenCalledWith('撤销 CSV 编辑失败');
    expect(feedback.error).toHaveBeenCalledWith('重做 CSV 编辑失败');
  });

  it('refreshes the workspace overview from the known root', async () => {
    const workspace = useWorkspaceStore();
    workspace.setGameOverview({ starsectorRoot: 'D:/games/starsector', coreAvailable: true, modsDir: 'mods', mods: [], warnings: [] });
    mocks.scanDirectoryGameOverview.mockResolvedValue({
      starsectorRoot: 'D:/games/starsector',
      coreAvailable: true,
      modsDir: 'mods',
      mods: [{ id: 'a' }],
      warnings: [],
    });
    const feedback = feedbackStub();
    const actions = useWorkspaceShellActions(feedback);
    await actions.refreshWorkspace();
    expect(mocks.scanDirectoryGameOverview).toHaveBeenCalledWith('D:/games/starsector');
    expect(feedback.success).toHaveBeenCalledWith(expect.stringContaining('1 个 Mod'));
  });
});
