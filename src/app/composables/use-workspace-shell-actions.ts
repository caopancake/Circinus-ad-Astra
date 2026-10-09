import { computed, getCurrentScope, h, onScopeDispose, ref, type Ref } from 'vue';
import { NSelect } from 'naive-ui/es/select';
import { WEAPON_SPEC_CLASSES, WEAPON_SPEC_CLASS_NOTE } from '@/domain/editors/spec-construction';
import type { WeaponSpecClass } from '@/shared/types';
import { NCheckbox } from 'naive-ui/es/checkbox';
import type { AppFeedback, GameScanWarning, ModOpeningFailure } from '@/shared/types';
import { useSettingsStore } from '@/stores/settings.store';
import { openEditorWindow } from '@/windows/editor.window';
import { useProjectStore } from '@/stores/project.store';
import { pickDirectory, scanDirectoryGameOverview } from '@/services/session.service';
import { pendingTableSave, saveTableChanges, type TableSaveResult } from '@/orchestrators/table-save.orchestrator';
import { useSaveCommandStore } from '@/stores/save-command.store';
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
  closeWorkspaceWindows,
  removeLoadedModRuntime,
  type WorkspaceCloseTarget,
} from '@/orchestrators/workspace-lifecycle.orchestrator';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { recordLogBestEffort } from '@/services/app-feedback-log.service';
import { logFields } from '@/shared/lib/log-fields';
import { queryEditorEditInfo } from '@/services/editor.service';

export function useWorkspaceShellActions(feedback: AppFeedback) {
  const project = useProjectStore();
  const tables = useTablesStore();
  const draftSessions = useDraftSessionsStore();
  const settings = useSettingsStore();
  const workspace = useWorkspaceStore();
  const saveCommands = useSaveCommandStore();
  const unregisterSave = saveCommands.registerSaveSession({
    targetKey: computed(() => {
      const target = pendingTableSave()?.target;
      return tables.saving && target ? JSON.stringify([target.manifest.sessionId, target.modRoot, target.table]) : null;
    }),
    modRoot: computed(() => (tables.saving ? (pendingTableSave()?.target.modRoot ?? null) : null)),
    saving: computed(() => tables.saving),
    waitForSave: () =>
      pendingTableSave()?.promise.then(
        (result) => result.status !== 'cancelled',
        () => false,
      ) ?? Promise.resolve(true),
  });
  let disposed = false;
  let closeIntent: Promise<void> | null = null;
  const removeIntents = new Map<string, Promise<void>>();
  if (getCurrentScope())
    onScopeDispose(() => {
      disposed = true;
      unregisterSave();
    });

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
    if (closeIntent) return closeIntent;
    closeIntent = requestWorkspaceClose()
      .catch((error: unknown) => feedback.error(error, '关闭工作区失败'))
      .finally(() => {
        closeIntent = null;
      });
    return closeIntent;
  }

  async function requestWorkspaceClose() {
    const pending = saveCommands.waitForSaves();
    if ((pending && !(await pending)) || disposed) return;
    const target = captureWorkspaceCloseTarget();
    const sessions = target.modRoots.map((root) => project.getSessionId(root));
    const hasDirtyMods = target.modRoots.some((modRoot) => draftSessions.hasUnsavedWorkForMod(modRoot));
    const choice = await feedback.choose({
      title: '关闭工作区',
      content: hasDirtyMods ? '当前工作区有未保存修改，关闭后这些修改将丢失。确认关闭？' : '确认关闭当前工作区？',
      choices: [{ label: '关闭', value: 'close', type: 'warning' }],
    });
    if (choice === 'close' && !disposed && target.modRoots.every((root, index) => project.getSessionId(root) === sessions[index]))
      await closeWorkspace(target);
  }

  function confirmRemoveMod(modRoot: string) {
    const active = removeIntents.get(modRoot);
    if (active) return active;
    const intent = requestModRemoval(modRoot)
      .catch((error: unknown) => feedback.error(error, '移除 Mod 失败'))
      .finally(() => {
        removeIntents.delete(modRoot);
      });
    removeIntents.set(modRoot, intent);
    return intent;
  }

  async function requestModRemoval(modRoot: string) {
    const sessionId = project.getSessionId(modRoot);
    const pending = saveCommands.waitForSaves(modRoot);
    if ((pending && !(await pending)) || disposed) return;
    if (draftSessions.hasUnsavedWorkForMod(modRoot)) {
      const choice = await feedback.choose({
        title: '移除 Mod',
        content: '该 Mod 有未保存修改，移除后修改将丢失。确认移除？',
        choices: [{ label: '移除', value: 'remove', type: 'warning' }],
      });
      if (choice !== 'remove') return;
    }
    if (!disposed && project.getSessionId(modRoot) === sessionId) await removeMod(modRoot);
  }

  async function saveChanges() {
    if (tables.saving) return;
    try {
      const result = await saveTableChanges({
        table: tables.currentTab,
        manifest: project.activeManifest,
        selectAssociatedSpecs,
        feedback,
      });
      showSaveResult(result);
    } catch (err) {
      feedback.error(err, '保存 CSV 失败');
    }
  }

  async function selectAssociatedSpecs(candidates: AssociatedSpecCandidate[]) {
    const choices = ref(candidates);
    const selectedKeys = ref(new Set(candidates.map((candidate) => candidate.key)));
    const choice = await feedback.choose({
      title: '保存 CSV',
      content: () => renderAssociatedSpecDialog(choices.value, selectedKeys),
      choices: [{ label: '保存', value: 'save', type: 'primary' }],
    });
    if (choice !== 'save') return null;
    return choices.value.filter((candidate) => selectedKeys.value.has(candidate.key)).map((candidate) => candidate.change);
  }

  function undoCurrentTableEdit() {
    return runTableAction(applyUndo);
  }

  function applyUndo() {
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
    return runTableAction(applyRedo);
  }

  function applyRedo() {
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
    const root = tables.activeModRoot;
    const table = tables.currentTab;
    try {
      if ((await commitCurrentInput()) === false || root !== tables.activeModRoot || table !== tables.currentTab) return;
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
    const root = tables.activeModRoot;
    const table = tables.currentTab;
    const rowKey = tables.selectedRowKey;
    try {
      const target = tables.editing;
      if (target?.rowKey === tables.selectedRowKey) {
        tables.getTableInputs(target.modRoot, target.table).cancel();
        tables.setActiveCell(null, target.modRoot);
      } else if ((await commitCurrentInput()) === false) return;
      if (root !== tables.activeModRoot || table !== tables.currentTab || rowKey !== tables.selectedRowKey) return;
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

  function commitCurrentInput() {
    const root = tables.activeModRoot;
    return root ? tables.getTableInputs(root, tables.currentTab).commit() : undefined;
  }

  function runTableAction(action: () => void) {
    const pending = commitCurrentInput();
    if (!pending) {
      action();
      return;
    }
    const root = tables.activeModRoot;
    const table = tables.currentTab;
    return pending
      .then((accepted) => {
        if (accepted && tables.activeModRoot === root && tables.currentTab === table) action();
      })
      .catch((error: unknown) => feedback.error(error));
  }

  function handleDetailAction(action: TableDetailAction) {
    if (action.type === 'file-editor') {
      void queryEditorEditInfo(action.sessionId, action.kind, action.id)
        .then((info) =>
          openRequestedFileEditor({
            modRoot: action.modRoot,
            sessionId: action.sessionId,
            title: action.title,
            path: info.target.write.path,
          }),
        )
        .catch((error) => feedback.error(error, '读取规格文件目标失败'));
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
    if (!(await removeLoadedModRuntime(modRoot))) return;
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
    if (!(await closeWorkspaceRuntime(target))) return;
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

  function showSaveResult(result: TableSaveResult) {
    if (result.status === 'saved') {
      feedback.success('当前 CSV 表已保存');
    } else if (result.status === 'noop') {
      feedback.info('没有需要保存的修改');
    }
  }

  function renderAssociatedSpecDialog(candidates: AssociatedSpecCandidate[], selectedKeys: Ref<Set<string>>) {
    return h('div', { class: 'associated-save-dialog' }, [
      h('p', '勾选的关联 spec 动作随本次 CSV 一起保存，并形成一次文件历史。武器类型用于新建及重命名来源缺失时的创建。'),
      candidates.some((candidate) => candidate.change.action !== 'delete' && candidate.change.create.kind === 'weapon')
        ? h('p', WEAPON_SPEC_CLASS_NOTE)
        : null,
      h(
        'div',
        { class: 'associated-save-list' },
        candidates.map((candidate) => {
          const change = candidate.change;
          const weaponCreate = change.action !== 'delete' && change.create.kind === 'weapon' ? change.create : null;
          return h('div', { class: 'associated-save-item' }, [
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
            weaponCreate
              ? h(NSelect, {
                  value: weaponCreate.specClass,
                  options: WEAPON_SPEC_CLASSES.map((specClass) => ({ label: specClass, value: specClass })),
                  'onUpdate:value': (specClass: WeaponSpecClass) => {
                    weaponCreate.specClass = specClass;
                  },
                })
              : null,
          ]);
        }),
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
    closeWorkspaceWindows,
    selectAssociatedSpecs,
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
