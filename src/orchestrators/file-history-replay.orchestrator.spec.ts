import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppFeedback, FileChangeRecord, FileSaveHistoryEntry } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  replayFileChangeSet: vi.fn(),
  refreshLoadedSessionsAfterWrite: vi.fn(async () => [] as { manifest: { modRoot: string } }[]),
  emitWindowEvent: vi.fn(async (...args: unknown[]) => {
    void args;
  }),
}));

vi.mock('@/services/write.service', () => ({
  replayFileChangeSet: mocks.replayFileChangeSet,
}));

vi.mock('@/orchestrators/project-session-refresh.orchestrator', () => ({
  refreshLoadedSessionsAfterWrite: mocks.refreshLoadedSessionsAfterWrite,
}));

vi.mock('@/windows/tauri.events', () => ({
  emitWindowEvent: mocks.emitWindowEvent,
  listenWindowEvent: vi.fn(async () => async () => {}),
}));

import { createFileReplayPlan, executeFileReplayPlan, replayNextFileRedo, replayNextFileUndo } from './file-history-replay.orchestrator';
import { useFileHistoryStore } from '@/stores/file-history.store';

interface ProjectStub {
  activeModRoot: string | null;
  getSessionId(modRoot: string): string | null;
}

function projectStub(activeModRoot: string | null, sessionId: string | null): ProjectStub {
  return { activeModRoot, getSessionId: () => sessionId };
}

function tablesStub() {
  return { selectRowByKey: vi.fn() };
}

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

function changeRecord(path: string): FileChangeRecord {
  return {
    kind: 'file',
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

function pushEntry(modRoot: string, label: string, changes: FileChangeRecord[]): FileSaveHistoryEntry {
  useFileHistoryStore().pushSavedWriteEntry(modRoot, changes, label);
  const stacks = useFileHistoryStore().getHistoryStacks(modRoot);
  return stacks.undoStack[stacks.undoStack.length - 1]!;
}

const emptyReplay = { changes: [], invalidation: {}, keyMap: [], refreshedEntity: null };

describe('createFileReplayPlan', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('returns null without an active mod, session or history entry', () => {
    expect(createFileReplayPlan(projectStub(null, 's1') as never, 'undo')).toBeNull();
    expect(createFileReplayPlan(projectStub('C:/mods/alpha', null) as never, 'undo')).toBeNull();
    expect(createFileReplayPlan(projectStub('C:/mods/alpha', 's1') as never, 'undo')).toBeNull();
  });

  it('peeks the top undo entry with the undo action text', () => {
    const entry = pushEntry('C:/mods/alpha', 'save one', [changeRecord('data/hulls/x.ship')]);
    const plan = createFileReplayPlan(projectStub('C:/mods/alpha', 's1') as never, 'undo');
    expect(plan?.actionText).toBe('撤销');
    expect(plan?.direction).toBe('undo');
    expect(plan?.modRoot).toBe('C:/mods/alpha');
    expect(plan?.sessionId).toBe('s1');
    expect(plan?.entry.id).toBe(entry.id);
  });
});

describe('executeFileReplayPlan', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('replays the changes, commits the entry and refreshes the active table', async () => {
    const entry = pushEntry('C:/mods/alpha', 'save one', [changeRecord('data/hulls/x.ship')]);
    const plan = createFileReplayPlan(projectStub('C:/mods/alpha', 's1') as never, 'undo')!;
    const fileHistory = useFileHistoryStore();
    const tables = tablesStub();
    mocks.replayFileChangeSet.mockResolvedValue(emptyReplay);
    mocks.refreshLoadedSessionsAfterWrite.mockResolvedValue([{ manifest: { modRoot: 'C:/mods/alpha' } }]);

    await executeFileReplayPlan(plan, projectStub('C:/mods/alpha', 's1') as never, tables as never);
    expect(mocks.replayFileChangeSet).toHaveBeenCalledWith('s1', 'C:/mods/alpha', 'undo', entry.changes);
    expect(fileHistory.getHistoryStacks('C:/mods/alpha').undoStack).toHaveLength(0);
    expect(tables.selectRowByKey).toHaveBeenCalledWith(null);
    expect(mocks.emitWindowEvent).toHaveBeenCalledWith(
      'file-editor-text-applied',
      expect.objectContaining({ path: 'data/hulls/x.ship', sessionId: 's1' }),
    );
  });

  it('rejects replay when the history stack moved between plan and execution', async () => {
    pushEntry('C:/mods/alpha', 'save one', [changeRecord('data/hulls/x.ship')]);
    const plan = createFileReplayPlan(projectStub('C:/mods/alpha', 's1') as never, 'undo')!;
    pushEntry('C:/mods/alpha', 'save two', [changeRecord('data/hulls/y.ship')]);
    await expect(executeFileReplayPlan(plan, projectStub('C:/mods/alpha', 's1') as never, tablesStub() as never)).rejects.toMatchObject({
      action: 'execute-file-history-replay',
    });
  });

  it('rejects replay when the project session changed', async () => {
    pushEntry('C:/mods/alpha', 'save one', [changeRecord('data/hulls/x.ship')]);
    const plan = createFileReplayPlan(projectStub('C:/mods/alpha', 's1') as never, 'undo')!;
    await expect(executeFileReplayPlan(plan, projectStub('C:/mods/alpha', 's2') as never, tablesStub() as never)).rejects.toMatchObject({
      action: 'execute-file-history-replay',
    });
  });

  it('keeps a pending synchronization record when refresh fails after disk commit', async () => {
    const root = 'C:/mods/alpha';
    const entry = pushEntry(root, 'save one', [changeRecord('mod_info.json')]);
    const project = projectStub(root, 's1');
    const plan = createFileReplayPlan(project as never, 'undo')!;
    mocks.replayFileChangeSet.mockResolvedValueOnce(emptyReplay);
    const { useWriteSyncStore } = await import('@/stores/write-sync.store');
    useWriteSyncStore().enqueue(root, 's1', entry.changes);
    mocks.refreshLoadedSessionsAfterWrite.mockRejectedValueOnce(new Error('parse failed'));
    await expect(executeFileReplayPlan(plan, project as never, tablesStub() as never)).rejects.toThrow('parse failed');
    expect(useFileHistoryStore().peekSavedWriteUndo(root)).toBeNull();
    expect(useFileHistoryStore().peekSavedWriteRedo(root)?.id).toBe(entry.id);
    expect(useWriteSyncStore().pending).toHaveLength(1);
  });

  it('notifies open file editors with restored text for text changes only', async () => {
    const entry = pushEntry('C:/mods/alpha', 'mixed save', [
      changeRecord('data/hulls/text.ship'),
      { ...changeRecord('data/graphics/binary.png'), beforeText: null, afterText: null, beforeDataBase64: 'aaa', afterDataBase64: 'bbb' },
      { ...changeRecord('data/hulls/dir.ship'), kind: 'directory' as const },
    ]);
    expect(useFileHistoryStore().commitReplayUndo('C:/mods/alpha', entry.id)).toBe(true);
    const plan = createFileReplayPlan(projectStub('C:/mods/alpha', 's1') as never, 'redo')!;
    mocks.replayFileChangeSet.mockResolvedValue(emptyReplay);

    await executeFileReplayPlan(plan, projectStub('C:/mods/alpha', 's1') as never, tablesStub() as never);
    expect(mocks.emitWindowEvent).toHaveBeenCalledTimes(1);
    expect(mocks.emitWindowEvent.mock.calls[0]![1]).toMatchObject({ path: 'data/hulls/text.ship' });
  });
});

describe('replayNextFileUndo / Redo', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('confirms with the user before writing back to disk', async () => {
    pushEntry('C:/mods/alpha', 'save one', [changeRecord('data/hulls/x.ship')]);
    const feedback = feedbackStub();

    const started = replayNextFileUndo(projectStub('C:/mods/alpha', 's1') as never, tablesStub() as never, feedback);
    expect(started).toBe(true);
    expect(feedback.confirmWarning).toHaveBeenCalledTimes(1);
    expect(mocks.replayFileChangeSet).not.toHaveBeenCalled();

    await (feedback.confirmWarning as ReturnType<typeof vi.fn>).mock.calls[0]![0].onConfirm();
    await vi.waitFor(() => expect(mocks.replayFileChangeSet).toHaveBeenCalled());
    await vi.waitFor(() => expect(feedback.success).toHaveBeenCalledWith('文件历史已撤销'));
  });

  it('reports replay failures through the feedback channel', async () => {
    const entry = pushEntry('C:/mods/alpha', 'save one', [changeRecord('data/hulls/x.ship')]);
    expect(useFileHistoryStore().commitReplayUndo('C:/mods/alpha', entry.id)).toBe(true);
    mocks.replayFileChangeSet.mockRejectedValue(new Error('disk full'));
    const feedback = feedbackStub();

    replayNextFileRedo(projectStub('C:/mods/alpha', 's1') as never, tablesStub() as never, feedback);
    await (feedback.confirmWarning as ReturnType<typeof vi.fn>).mock.calls[0]![0].onConfirm();
    await vi.waitFor(() => expect(feedback.error).toHaveBeenCalled());
  });

  it('returns false when there is nothing to replay', () => {
    const feedback = feedbackStub();
    expect(replayNextFileUndo(projectStub('C:/mods/alpha', 's1') as never, tablesStub() as never, feedback)).toBe(false);
    expect(feedback.confirmWarning).not.toHaveBeenCalled();
  });
});
