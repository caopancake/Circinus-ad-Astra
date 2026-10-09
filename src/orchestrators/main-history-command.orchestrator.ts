import type { AppFeedback } from '@/shared/types';
import { replayNextFileRedo, replayNextFileUndo } from '@/orchestrators/file-history-replay.orchestrator';
import { useProjectStore } from '@/stores/project.store';
import { useTablesEditHistoryStore } from '@/stores/tables-edit-history.store';
import { useTablesStore } from '@/stores/tables.store';

export async function dispatchMainUndoCommand(feedback: AppFeedback) {
  const tables = useTablesStore();
  if (tables.currentTableLocked) return;
  const currentTableCsvHistory = useTablesEditHistoryStore();
  const project = useProjectStore();
  const modRoot = project.activeModRoot;
  const currentTable = tables.currentTab;

  if (modRoot && currentTableCsvHistory.canUndoCsvEdit(modRoot, currentTable)) {
    if (!currentTableCsvHistory.undoCsvEdit(modRoot, currentTable, tables.getActiveModTableState())) {
      feedback.error('撤销 CSV 编辑失败');
    }
    return;
  }

  replayNextFileUndo(project, tables, feedback);
}

export async function dispatchMainRedoCommand(feedback: AppFeedback) {
  const tables = useTablesStore();
  if (tables.currentTableLocked) return;
  const currentTableCsvHistory = useTablesEditHistoryStore();
  const project = useProjectStore();
  const modRoot = project.activeModRoot;
  const currentTable = tables.currentTab;

  if (modRoot && currentTableCsvHistory.canRedoCsvEdit(modRoot, currentTable)) {
    if (!currentTableCsvHistory.redoCsvEdit(modRoot, currentTable, tables.getActiveModTableState())) {
      feedback.error('重做 CSV 编辑失败');
    }
    return;
  }

  replayNextFileRedo(project, tables, feedback);
}
