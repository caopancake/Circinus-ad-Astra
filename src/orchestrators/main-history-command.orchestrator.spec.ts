import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppFeedback } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  replayNextFileUndo: vi.fn(),
  replayNextFileRedo: vi.fn(),
  canUndoCsvEdit: vi.fn(() => false as boolean),
  canRedoCsvEdit: vi.fn(() => false as boolean),
  undoCsvEdit: vi.fn(() => null as string | null),
  redoCsvEdit: vi.fn(() => null as string | null),
  activeModRoot: vi.fn(() => 'C:/mods/alpha' as string | null),
}));

vi.mock('@/orchestrators/file-history-replay.orchestrator', () => ({
  replayNextFileUndo: mocks.replayNextFileUndo,
  replayNextFileRedo: mocks.replayNextFileRedo,
}));

vi.mock('@/stores/tables-edit-history.store', () => ({
  useTablesEditHistoryStore: () => ({
    canUndoCsvEdit: mocks.canUndoCsvEdit,
    canRedoCsvEdit: mocks.canRedoCsvEdit,
    undoCsvEdit: mocks.undoCsvEdit,
    redoCsvEdit: mocks.redoCsvEdit,
  }),
}));

vi.mock('@/stores/tables.store', () => ({
  useTablesStore: () => ({ currentTab: 'ships', getActiveModTableState: () => undefined }),
}));

vi.mock('@/stores/project.store', () => ({
  useProjectStore: () => ({
    get activeModRoot() {
      return mocks.activeModRoot();
    },
  }),
}));

import { dispatchMainRedoCommand, dispatchMainUndoCommand } from './main-history-command.orchestrator';

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('main history command dispatch', () => {
  it('prefers the current table CSV edit history for undo', async () => {
    mocks.canUndoCsvEdit.mockReturnValue(true);
    mocks.undoCsvEdit.mockReturnValue('edit 1');
    const feedback = feedbackStub();
    await dispatchMainUndoCommand(feedback);
    expect(mocks.undoCsvEdit).toHaveBeenCalledTimes(1);
    expect(mocks.replayNextFileUndo).not.toHaveBeenCalled();
    expect(feedback.error).not.toHaveBeenCalled();
  });

  it('reports a failed CSV undo without touching the file history', async () => {
    mocks.canUndoCsvEdit.mockReturnValue(true);
    mocks.undoCsvEdit.mockReturnValue(null);
    const feedback = feedbackStub();
    await dispatchMainUndoCommand(feedback);
    expect(feedback.error).toHaveBeenCalledWith('撤销 CSV 编辑失败');
    expect(mocks.replayNextFileUndo).not.toHaveBeenCalled();
  });

  it('falls back to the file history replay without CSV entries', async () => {
    mocks.canUndoCsvEdit.mockReturnValue(false);
    await dispatchMainUndoCommand(feedbackStub());
    expect(mocks.replayNextFileUndo).toHaveBeenCalledTimes(1);
  });

  it('prefers the CSV redo stack and reports redo failures', async () => {
    mocks.canRedoCsvEdit.mockReturnValue(true);
    mocks.redoCsvEdit.mockReturnValue('edit 2');
    const feedback = feedbackStub();
    await dispatchMainRedoCommand(feedback);
    expect(mocks.redoCsvEdit).toHaveBeenCalledTimes(1);
    expect(mocks.replayNextFileRedo).not.toHaveBeenCalled();

    mocks.redoCsvEdit.mockReturnValue(null);
    const feedback2 = feedbackStub();
    await dispatchMainRedoCommand(feedback2);
    expect(feedback2.error).toHaveBeenCalledWith('重做 CSV 编辑失败');
    expect(mocks.replayNextFileRedo).not.toHaveBeenCalled();
  });

  it('falls back to the file history replay for redo', async () => {
    mocks.canRedoCsvEdit.mockReturnValue(false);
    await dispatchMainRedoCommand(feedbackStub());
    expect(mocks.replayNextFileRedo).toHaveBeenCalledTimes(1);
  });
});
