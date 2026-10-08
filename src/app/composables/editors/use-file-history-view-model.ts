import { computed, watch } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { replayNextFileRedo, replayNextFileUndo } from '@/orchestrators/file-history-replay.orchestrator';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { useProjectStore } from '@/stores/project.store';
import { useTablesStore } from '@/stores/tables.store';
import { clearSavedFileHistory, loadFileHistory } from '@/services/file-history.service';

export function useFileHistoryViewModel() {
  const project = useProjectStore();
  const tables = useTablesStore();
  const fileHistory = useFileHistoryStore();
  const feedback = useAppFeedback();

  const activeMod = computed(() => project.activeManifest);
  watch(
    () => activeMod.value?.sessionId,
    async () => {
      const target = activeMod.value;
      if (!target) return;
      try {
        const snapshot = await loadFileHistory(target.sessionId, target.modRoot);
        if (project.getSessionId(target.modRoot) === target.sessionId) fileHistory.applySnapshot(target.modRoot, snapshot);
      } catch (error) {
        feedback.error(error, '读取文件历史失败');
      }
    },
    { immediate: true },
  );
  const modTitle = computed(() => activeMod.value?.modInfo?.name ?? activeMod.value?.modRoot ?? '未选择 Mod');
  const stacks = computed(() =>
    activeMod.value ? fileHistory.getHistoryStacks(activeMod.value.modRoot) : { undoStack: [], redoStack: [] },
  );
  const undoStack = computed(() => stacks.value.undoStack);
  const redoStack = computed(() => stacks.value.redoStack);
  const undoDisplayItems = computed(() => [...undoStack.value].reverse());
  const redoDisplayItems = computed(() => [...redoStack.value].reverse());
  const historyCount = computed(() => undoStack.value.length + redoStack.value.length);
  const canUndo = computed(() => Boolean(fileHistory.peekSavedWriteUndo(activeMod.value?.modRoot ?? null)));
  const canRedo = computed(() => Boolean(fileHistory.peekSavedWriteRedo(activeMod.value?.modRoot ?? null)));

  function confirmClear() {
    const modData = activeMod.value;
    if (!modData || historyCount.value === 0) return;
    feedback.confirmWarning({
      title: '清空文件历史',
      content: '这会清空当前 Mod 的文件级 undo/redo 栈，不会修改任何磁盘文件。确认清空？',
      actionText: '清空',
      onConfirm: async () => {
        try {
          const snapshot = await clearSavedFileHistory(modData.sessionId, modData.modRoot);
          if (project.getSessionId(modData.modRoot) === modData.sessionId) fileHistory.applySnapshot(modData.modRoot, snapshot);
          feedback.success('文件历史已清空');
        } catch (error) {
          feedback.error(error, '清空文件历史失败');
        }
      },
    });
  }

  function undoOne() {
    replayNextFileUndo(project, tables, feedback);
  }

  function redoOne() {
    replayNextFileRedo(project, tables, feedback);
  }

  return {
    modTitle,
    undoStack,
    redoStack,
    undoDisplayItems,
    redoDisplayItems,
    historyCount,
    canUndo,
    canRedo,
    confirmClear,
    undoOne,
    redoOne,
  };
}
