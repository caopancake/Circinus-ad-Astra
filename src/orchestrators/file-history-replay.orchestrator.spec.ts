import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppFeedback, FileChangeRecord, FileSaveHistoryEntry, WriteResult } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  replayFileChangeSet: vi.fn(),
  refreshLoadedSessionsAfterWrite: vi.fn(async () => [] as { manifest: { modRoot: string } }[]),
  emitWindowEvent: vi.fn(async () => {}),
  loadFileHistory: vi.fn(),
}));
vi.mock('@/services/write.service', () => ({ replayFileChangeSet: mocks.replayFileChangeSet }));
vi.mock('@/services/file-history.service', () => ({ loadFileHistory: mocks.loadFileHistory }));
vi.mock('@/orchestrators/project-session-refresh.orchestrator', () => ({
  refreshLoadedSessionsAfterWrite: mocks.refreshLoadedSessionsAfterWrite,
}));
vi.mock('@/windows/tauri.events', () => ({ emitWindowEvent: mocks.emitWindowEvent }));
import { createFileReplayPlan, executeFileReplayPlan, replayNextFileRedo, replayNextFileUndo } from './file-history-replay.orchestrator';
import { useFileHistoryStore } from '@/stores/file-history.store';

const root = 'C:/mods/alpha';
function project(session = 's1') {
  return { activeModRoot: root, getSessionId: () => session } as never;
}
function tables() {
  return { selectRowByKey: vi.fn() } as never;
}
function feedback(): AppFeedback {
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
function entry(id = 1): FileSaveHistoryEntry {
  return { id, timestamp: id, label: 'saved file', paths: ['C:/mods/alpha/notes.txt'] };
}
function change(): FileChangeRecord {
  return {
    kind: 'file',
    path: entry().paths[0]!,
    beforeExists: true,
    beforeText: 'B',
    beforeDataBase64: null,
    beforeFiles: [],
    afterExists: true,
    afterText: 'A',
    afterDataBase64: null,
    afterFiles: [],
  };
}
function savedResult(): WriteResult {
  return {
    changes: [change()],
    invalidation: { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false },
    keyMap: [],
    refreshedEntity: null,
    baseVersions: [],
    commitId: 2,
    history: { revision: 2, undoStack: [], redoStack: [entry()] },
  };
}

describe('authoritative file history replay', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.resetAllMocks();
    useFileHistoryStore().applySnapshot(root, { revision: 1, undoStack: [entry()], redoStack: [] });
    mocks.loadFileHistory.mockImplementation(async () => useFileHistoryStore().getHistoryStacks(root));
    mocks.refreshLoadedSessionsAfterWrite.mockResolvedValue([]);
    mocks.emitWindowEvent.mockResolvedValue(undefined);
    mocks.replayFileChangeSet.mockResolvedValue(savedResult());
  });

  it('captures the backend history revision and entry identity', () => {
    const plan = createFileReplayPlan(project(), 'undo')!;
    expect(plan).toMatchObject({ sessionId: 's1', revision: 1, direction: 'undo', entry: { id: 1 } });
  });

  it('returns no plan for an empty stack or absent target', () => {
    expect(createFileReplayPlan(project(), 'redo')).toBeNull();
    expect(createFileReplayPlan({ activeModRoot: null } as never, 'undo')).toBeNull();
  });

  it('submits the entry id and adopts actual replay history before synchronization', async () => {
    const plan = createFileReplayPlan(project(), 'undo')!;
    await executeFileReplayPlan(plan, project(), tables());
    expect(mocks.replayFileChangeSet).toHaveBeenCalledWith('s1', root, 'undo', 1, 1);
    expect(useFileHistoryStore().getHistoryStacks(root)).toEqual(savedResult().history);
    expect(mocks.emitWindowEvent).toHaveBeenCalledWith('file-editor-text-applied', expect.objectContaining({ text: 'A' }));
  });

  it('keeps committed backend history when refresh fails', async () => {
    mocks.refreshLoadedSessionsAfterWrite.mockRejectedValue(new Error('parse failed'));
    const plan = createFileReplayPlan(project(), 'undo')!;
    await expect(executeFileReplayPlan(plan, project(), tables())).rejects.toThrow('parse failed');
    expect(useFileHistoryStore().getHistoryStacks(root)).toEqual(savedResult().history);
  });

  it('preserves the projection when disk replay fails', async () => {
    mocks.replayFileChangeSet.mockRejectedValue(new Error('disk full'));
    const plan = createFileReplayPlan(project(), 'undo')!;
    await expect(executeFileReplayPlan(plan, project(), tables())).rejects.toThrow('disk full');
    expect(useFileHistoryStore().getHistoryStacks(root).revision).toBe(1);
  });

  it('rejects changed session and changed history targets before writing', async () => {
    const plan = createFileReplayPlan(project(), 'undo')!;
    await expect(executeFileReplayPlan(plan, project('s2'), tables())).rejects.toMatchObject({ action: 'execute-file-history-replay' });
    useFileHistoryStore().applySnapshot(root, { revision: 2, undoStack: [entry(2)], redoStack: [] });
    await expect(executeFileReplayPlan(plan, project(), tables())).rejects.toMatchObject({ action: 'execute-file-history-replay' });
    expect(mocks.replayFileChangeSet).not.toHaveBeenCalled();
  });

  it('requires confirmation after reading the latest backend history', async () => {
    const messages = feedback();
    expect(await replayNextFileUndo(project(), tables(), messages)).toBe(true);
    expect(mocks.loadFileHistory).toHaveBeenCalledWith('s1', root);
    expect(mocks.replayFileChangeSet).not.toHaveBeenCalled();
    await (messages.confirmWarning as ReturnType<typeof vi.fn>).mock.calls[0]![0].onConfirm();
    expect(messages.success).toHaveBeenCalledWith('文件历史已撤销');
  });

  it('reports replay failures through the feedback boundary', async () => {
    useFileHistoryStore().applySnapshot(root, { revision: 2, undoStack: [], redoStack: [entry()] });
    mocks.replayFileChangeSet.mockRejectedValue(new Error('disk full'));
    const messages = feedback();
    await replayNextFileRedo(project(), tables(), messages);
    await (messages.confirmWarning as ReturnType<typeof vi.fn>).mock.calls[0]![0].onConfirm();
    expect(messages.error).toHaveBeenCalledWith(expect.anything(), '重做文件历史失败');
  });

  it('uses the backend snapshot to reject a stale empty projection', async () => {
    mocks.loadFileHistory.mockResolvedValue({ revision: 3, undoStack: [], redoStack: [] });
    expect(await replayNextFileUndo(project(), tables(), feedback())).toBe(false);
    expect(useFileHistoryStore().getHistoryStacks(root).revision).toBe(3);
  });

  it('ignores an older delivered history snapshot', () => {
    useFileHistoryStore().applySnapshot(root, savedResult().history);
    useFileHistoryStore().applySnapshot(root, { revision: 1, undoStack: [entry()], redoStack: [] });
    expect(useFileHistoryStore().getHistoryStacks(root)).toEqual(savedResult().history);
  });

  it('expands directory replay notifications using the actual after snapshot', async () => {
    const result = savedResult();
    result.changes = [
      {
        ...change(),
        kind: 'directory',
        path: root + '/mission',
        beforeFiles: [{ relPath: 'old.txt', text: 'old', dataBase64: null }],
        afterFiles: [{ relPath: 'new.txt', text: 'restored', dataBase64: null }],
      },
    ];
    mocks.replayFileChangeSet.mockResolvedValue(result);
    await executeFileReplayPlan(createFileReplayPlan(project(), 'undo')!, project(), tables());
    expect(mocks.emitWindowEvent).toHaveBeenCalledWith(
      'file-editor-text-applied',
      expect.objectContaining({ path: expect.stringMatching(/mission[\\/]new\.txt$/), text: 'restored' }),
    );
    expect(mocks.emitWindowEvent).toHaveBeenCalledWith(
      'file-editor-text-applied',
      expect.objectContaining({ path: expect.stringMatching(/mission[\\/]old\.txt$/), text: '' }),
    );
  });
});
