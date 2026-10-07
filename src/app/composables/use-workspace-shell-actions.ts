import { h, ref, type Ref } from 'vue';
import { NCheckbox } from 'naive-ui/es/checkbox';
import type { AppFeedback, GameScanWarning, ModOpeningFailure } from '@/shared/types';
import { useSettingsStore } from '@/stores/settings.store';
import { openEditorWindow } from '@/windows/editor.window';
import { useProjectStore } from '@/stores/project.store';
import { pickDirectory, scanDirectoryGameOverview } from '@/services/session.service';
import { captureActiveTableSaveTarget, saveCapturedTableChanges } from '@/orchestrators/table-save.orchestrator';
import { useTablesStore } from '@/stores/tables.store';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import type { AssociatedSpecCandidate } from '@/domain/tables/associated-spec-candidates';
import type { TableDetailAction } from '@/domain/tables/table-detail-actions';
import {
  openFileEditorWindow,
  openGameWarningFileEditor,
  openModOpeningFailureFileEditor,
  type FileEditorRequest,
} from '@/windows/file-editor.window';
import { openDirectoryTarget, openModFromOverview, type DirectoryOpeningOutcome } from '@/orchestrators/directory-opening.orchestrator';
import {
  captureWorkspaceCloseTarget,
  closeWorkspaceRuntime,
  removeLoadedModRuntime,
  type WorkspaceCloseTarget,
} from '@/orchestrators/workspace-lifecycle.orchestrator';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { recordLogBestEffort } from '@/services/app-feedback-log.service';
import { logFields } from '@/shared/lib/log-fields';

export function useWorkspaceShellActions(feedback: AppFeedback) {
  const project = useProjectStore();
  const tables = useTablesStore();
  const draftSessions = useDraftSessionsStore();
  const settings = useSettingsStore();
  const workspace = useWorkspaceStore();

  async function openDirectory() {
    try {
      const selected = await pickDirectory();
      if (!selected) return;
      const outcome = await openDirectoryTarget(selected, settings.starsectorRoot);
      handleDirectoryOpeningOutcome(outcome, selected);
    } catch (err) {
      feedback.error(err);
    }
  }

  async function loadOverviewMod(modRoot: string) {
    try {
      const outcome = await openModFromOverview(modRoot);
      handleDirectoryOpeningOutcome(outcome, modRoot);
    } catch (err) {
      feedback.error(err);
    }
  }

  async function refreshWorkspace() {
    const root = workspace.gameOverview?.starsectorRoot;
    if (!root) return;
    const generation = workspace.getWorkspaceGeneration();
    try {
      const overview = await scanDirectoryGameOverview(root);
      if (workspace.getWorkspaceGeneration() !== generation || workspace.gameOverview?.starsectorRoot !== root) return;
      workspace.clearModOpeningFailures();
      workspace.setGameOverview(overview);
      settings.setStarsectorRoot(overview.starsectorRoot);
      recordLogBestEffort({
        level: 'info',
        code: 'workspace.refreshed',
        message: 'workspace refreshed',
        path: null,
        line: null,
        fields: { root: overview.starsectorRoot, mods: String(overview.mods.length) },
      });
      feedback.success(`工作区已刷新：${overview.mods.length} 个 Mod`);
    } catch (err) {
      feedback.error(err, '刷新工作区失败');
    }
  }

  function confirmCloseWorkspace() {
    const target = captureWorkspaceCloseTarget();
    const hasDirtyMods = target.modRoots.some((modRoot) => draftSessions.hasUnsavedWorkForMod(modRoot));
    feedback.confirmWarning({
      title: '关闭工作区',
      content: hasDirtyMods ? '当前工作区有未保存修改，关闭后这些修改将丢失。确认关闭？' : '确认关闭当前工作区？',
      actionText: '关闭',
      onConfirm: () => closeWorkspace(target),
    });
  }

  function confirmRemoveMod(modRoot: string) {
    if (draftSessions.hasUnsavedWorkForMod(modRoot)) {
      feedback.confirmWarning({
        title: '移除 Mod',
        content: '该 Mod 有未保存修改，移除后修改将丢失。确认移除？',
        actionText: '移除',
        onConfirm: () => removeMod(modRoot),
      });
    } else {
      void removeMod(modRoot);
    }
  }

  async function saveChanges() {
    try {
      const target = captureActiveTableSaveTarget(project.activeManifest);
      if (!target) return;
      const candidates = target.associatedSpecCandidates;
      if (candidates.length > 0) {
        const selectedAssociatedSpecKeys = ref<Set<string>>(new Set(candidates.map((candidate) => candidate.key)));
        feedback.confirmWarning({
          title: '保存 CSV',
          content: () => renderAssociatedSpecDialog(candidates, selectedAssociatedSpecKeys),
          actionText: '保存',
          onConfirm: async () => {
            try {
              const selected = candidates
                .filter((candidate) => selectedAssociatedSpecKeys.value.has(candidate.key))
                .map(({ action, id, previousId, row }) => ({
                  action,
                  id,
                  previousId,
                  row,
                }));
              const result = await saveCapturedTableChanges(target, selected, feedback);
              showSaveResult(result);
            } catch (err) {
              feedback.error(err, '保存 CSV 失败');
            }
          },
        });
        return;
      }
      const result = await saveCapturedTableChanges(target, [], feedback);
      showSaveResult(result);
    } catch (err) {
      feedback.error(err, '保存 CSV 失败');
    }
  }

  function undoCurrentTableEdit() {
    const label = tables.undoCurrentTableEdit();
    if (label === null) {
      feedback.error('撤销 CSV 编辑失败');
      return;
    }
    recordLogBestEffort({
      level: 'info',
      code: 'tables.undo_applied',
      message: 'csv undo applied',
      path: null,
      line: null,
      fields: logFields({ modRoot: tables.activeModRoot, table: tables.currentTab, label }),
    });
  }

  function redoCurrentTableEdit() {
    const label = tables.redoCurrentTableEdit();
    if (label === null) {
      feedback.error('重做 CSV 编辑失败');
      return;
    }
    recordLogBestEffort({
      level: 'info',
      code: 'tables.redo_applied',
      message: 'csv redo applied',
      path: null,
      line: null,
      fields: logFields({ modRoot: tables.activeModRoot, table: tables.currentTab, label }),
    });
  }

  async function addNewRow() {
    if (!project.activeManifest) return;
    try {
      const created = await tables.addNewRow();
      recordLogBestEffort({
        level: 'info',
        code: 'tables.row_created',
        message: 'row created',
        path: null,
        line: null,
        fields: logFields({
          modRoot: tables.activeModRoot,
          table: tables.currentTab,
          rowKey: created?.rowKey,
          rowIndex: created?.rowIndex,
        }),
      });
    } catch (err) {
      feedback.error(err, '新建 CSV 行失败');
    }
  }

  async function deleteSelectedRow() {
    if (!project.activeManifest || !tables.selectedRowKey) return;
    try {
      const deleted = await tables.deleteSelected();
      recordLogBestEffort({
        level: 'info',
        code: 'tables.row_deleted',
        message: 'row deleted',
        path: null,
        line: null,
        fields: logFields({
          modRoot: tables.activeModRoot,
          table: tables.currentTab,
          rowKey: deleted?.rowKey,
          rowIndex: deleted?.rowIndex,
        }),
      });
    } catch (err) {
      feedback.error(err, '删除 CSV 行失败');
    }
  }

  function handleDetailAction(action: TableDetailAction) {
    if (action.type === 'file-editor') {
      openRequestedFileEditor(action);
    } else {
      openRequestedEditorWindow(action);
    }
  }

  function openRequestedFileEditor(request: FileEditorRequest) {
    recordLogBestEffort({
      level: 'info',
      code: 'editor.file_opened',
      message: 'file editor opened',
      path: request.path,
      line: request.line ?? null,
      fields: logFields({ modRoot: request.modRoot, sessionId: request.sessionId }),
    });
    openFileEditorWindow({ ...request, settings: settings.settingsSnapshot() }).catch((error) =>
      feedback.error(error, '打开文件编辑器失败'),
    );
  }

  function openGameWarningFile(warning: GameScanWarning) {
    openGameWarningFileEditor(warning, settings.settingsSnapshot())?.catch((error) => feedback.error(error, '打开警告文件失败'));
  }

  function openModOpeningFailureFile(failure: ModOpeningFailure) {
    openModOpeningFailureFileEditor(failure, settings.settingsSnapshot())?.catch((error) => feedback.error(error, '打开错误文件失败'));
  }

  function handleDirectoryOpeningOutcome(outcome: DirectoryOpeningOutcome, path: string | null = null) {
    if (outcome.type === 'cancelled') return;
    if (outcome.type === 'game-overview') {
      if (workspace.gameOverview?.starsectorRoot) settings.setStarsectorRoot(workspace.gameOverview.starsectorRoot);
      feedback.success(`游戏目录已扫描：${outcome.availableModCount} 个 Mod`);
      recordLogBestEffort({
        level: 'info',
        code: 'directory.scanned',
        message: 'game directory scanned',
        path: null,
        line: null,
        fields: { root: outcome.root, mods: String(outcome.availableModCount) },
      });
    } else if (outcome.type === 'mod-loaded') {
      if (workspace.gameOverview?.starsectorRoot) settings.setStarsectorRoot(workspace.gameOverview.starsectorRoot);
      feedback.success(`Mod 已导入：${outcome.modName}`);
      for (const warning of outcome.warnings) {
        feedback.warning(warning);
      }
    } else if (outcome.type === 'already-loaded') {
      feedback.info('该 Mod 已在工作区中');
      recordLogBestEffort({
        level: 'info',
        code: 'mod.already_loaded',
        message: 'mod already loaded',
        path: null,
        line: null,
        fields: logFields({ modRoot: outcome.modRoot, name: outcome.modName }),
      });
    } else {
      feedback.error(outcome.message ?? '未识别该目录');
      recordLogBestEffort({
        level: 'info',
        code: 'directory.unrecognized',
        message: outcome.message ?? 'unrecognized directory',
        path,
        line: null,
        fields: null,
      });
    }
  }

  async function removeMod(modRoot: string, showMessage = true) {
    await removeLoadedModRuntime(modRoot);
    recordLogBestEffort({
      level: 'info',
      code: 'mod.removed',
      message: 'mod removed',
      path: null,
      line: null,
      fields: { modRoot },
    });
    if (showMessage) feedback.success('Mod 已从工作区移除');
  }

  async function closeWorkspace(target: WorkspaceCloseTarget) {
    await closeWorkspaceRuntime(target);
    recordLogBestEffort({
      level: 'info',
      code: 'workspace.closed',
      message: 'workspace closed',
      path: null,
      line: null,
      fields: { mods: String(target.modRoots.length) },
    });
    feedback.success('工作区已关闭');
  }

  function showSaveResult(result: 'saved' | 'noop' | 'cancelled') {
    if (result === 'saved') {
      feedback.success('当前 CSV 表已保存');
    } else if (result === 'noop') {
      feedback.info('没有需要保存的修改');
    }
  }

  function renderAssociatedSpecDialog(candidates: AssociatedSpecCandidate[], selectedKeys: Ref<Set<string>>) {
    return h('div', { class: 'associated-save-dialog' }, [
      h('p', '检测到 CSV 行变更可能需要同步关联 spec。只有勾选的动作会随本次 CSV 保存一起写入，并作为单次 history 记录。'),
      h(
        'div',
        { class: 'associated-save-list' },
        candidates.map((candidate) =>
          h(
            NCheckbox,
            {
              checked: selectedKeys.value.has(candidate.key),
              'onUpdate:checked': (checked: boolean) => {
                const next = new Set(selectedKeys.value);
                if (checked) next.add(candidate.key);
                else next.delete(candidate.key);
                selectedKeys.value = next;
              },
            },
            { default: () => candidate.label },
          ),
        ),
      ),
    ]);
  }

  function openRequestedEditorWindow(action: Extract<TableDetailAction, { type: 'editor-window' }>) {
    recordLogBestEffort({
      level: 'info',
      code: 'editor.window_opened',
      message: 'editor window opened',
      path: null,
      line: null,
      fields: logFields({ kind: action.kind, id: action.id, modRoot: action.modRoot, sessionId: action.sessionId }),
    });
    openEditorWindow({
      kind: action.kind,
      modRoot: action.modRoot,
      id: action.id,
      sessionId: action.sessionId,
      settings: settings.settingsSnapshot(),
      starsectorRoot: action.starsectorRoot,
    }).catch((error) => feedback.error(error, '打开编辑器窗口失败'));
  }

  return {
    addNewRow,
    confirmCloseWorkspace,
    confirmRemoveMod,
    deleteSelectedRow,
    handleDetailAction,
    loadOverviewMod,
    openGameWarningFile,
    openModOpeningFailureFile,
    openDirectory,
    redoCurrentTableEdit,
    refreshWorkspace,
    saveChanges,
    undoCurrentTableEdit,
  };
}
