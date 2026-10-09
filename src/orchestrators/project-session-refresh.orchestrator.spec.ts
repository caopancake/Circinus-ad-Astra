import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectManifest, ProjectSessionInvalidationResult, WriteResult, CommittedSessionUpdate } from '@/shared/types';
import type { CommittedWriteEvent } from '@/windows/window.events';
import { savedWriteFixture } from '@/test/write-result';
const mocks = vi.hoisted(() => ({
  synchronizeSessionCommit: vi.fn(),
  invalidateQueryCacheByProject: vi.fn(),
  invalidateResourceCacheByProject: vi.fn(),
  emitWindowEvent: vi.fn(),
  handler: null as null | ((event: CommittedWriteEvent) => Promise<void>),
}));
vi.mock('@/services/session.service', () => ({ synchronizeSessionCommit: mocks.synchronizeSessionCommit }));
vi.mock('@/services/query-cache.service', () => ({ invalidateQueryCacheByProject: mocks.invalidateQueryCacheByProject }));
vi.mock('@/services/resource-cache.service', () => ({ invalidateResourceCacheByProject: mocks.invalidateResourceCacheByProject }));
vi.mock('@/windows/current.window', () => ({ currentWindowLabel: () => 'main' }));
vi.mock('@/windows/tauri.events', () => ({
  emitWindowEvent: mocks.emitWindowEvent,
  listenWindowEvent: vi.fn(async (_name, handler) => {
    mocks.handler = handler;
    return () => {
      mocks.handler = null;
    };
  }),
}));
import {
  publishCommittedWrite,
  retryPendingProjectSessionWrites,
  listenCommittedWrites,
  applyProjectSessionCacheInvalid,
} from './project-session-refresh.orchestrator';
import { useWriteSyncStore } from '@/stores/write-sync.store';
import { useProjectStore } from '@/stores/project.store';
import { useFileHistoryStore } from '@/stores/file-history.store';
import { requireProjectionReady, markProjectionReady } from '@/shared/runtime/project-projection';
function manifestFixture(modRoot: string, sessionId: string): ProjectManifest {
  return {
    baseVersions: [],
    sessionId,
    modRoot,
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: [],
    modInfo: null,
    tableSummaries: {} as ProjectManifest['tableSummaries'],
    tableEntitySummaries: {} as ProjectManifest['tableEntitySummaries'],
    entitySummaries: {
      factions: 0,
      missions: 0,
      ships: 0,
      weapons: 0,
      projectiles: 0,
      variants: 0,
      skins: 0,
      systems: 0,
      skills: 0,
    },
    warnings: [],
  };
}

const root = 'C:/mods/alpha';
function projection(revision = 1): ProjectSessionInvalidationResult {
  return {
    projectionRevision: revision,
    manifest: { ...manifestFixture(root, 's1'), modInfo: { name: 'projection-' + revision } },
    invalidation: { paths: ['notes.txt'], tables: [], entities: [], resources: [], queryScopes: [], session: false },
  };
}
function receipt(commitId = 1, ready = true): WriteResult {
  const result = savedWriteFixture();
  result.commitId = commitId;
  result.history = {
    revision: commitId,
    undoStack: [{ id: commitId, timestamp: 0, label: 'notes', paths: [root + '/notes.txt'] }],
    redoStack: [],
  };
  result.changes = [
    {
      kind: 'file',
      beforePath: root + '/notes.txt',
      afterPath: root + '/notes.txt',
      beforeExists: true,
      beforeText: 'old',
      beforeDataBase64: null,
      beforeFiles: [],
      afterExists: true,
      afterText: 'new',
      afterDataBase64: null,
      afterFiles: [],
    },
  ];
  result.sessionUpdates = [
    ready
      ? { sessionId: 's1', modRoot: root, commitId, status: 'ready', projection: projection(commitId) }
      : { sessionId: 's1', modRoot: root, commitId, status: 'pending', error: { code: 'parse.json', message: 'bad spec' } },
  ];
  return result;
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mocks.handler = null;
  mocks.emitWindowEvent.mockResolvedValue(undefined);
  useProjectStore().registerProjectManifest(manifestFixture(root, 's1'));
});
afterEach(() => markProjectionReady('s1'));

describe('committed session synchronization', () => {
  it('accepts the transaction projection and history then invalidates resources before queries', async () => {
    const written = receipt();
    await publishCommittedWrite(root, written, 's1');
    expect(mocks.synchronizeSessionCommit).not.toHaveBeenCalled();
    expect(useProjectStore().getManifest(root)?.modInfo?.name).toBe('projection-1');
    expect(useFileHistoryStore().getHistoryStacks(root)).toEqual(written.history);
    expect(mocks.invalidateResourceCacheByProject.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.invalidateQueryCacheByProject.mock.invocationCallOrder[0]!,
    );
    expect(mocks.emitWindowEvent).toHaveBeenCalledWith(
      'committed-write-applied',
      expect.objectContaining({ originWindowLabel: 'main', result: written, reason: 'save' }),
    );
  });
  it('retains pending projection failures and resumes their exact backend commit', async () => {
    mocks.synchronizeSessionCommit.mockRejectedValueOnce(new Error('parse failed'));
    await expect(publishCommittedWrite(root, receipt(1, false), 's1')).rejects.toThrow('parse failed');
    expect(useWriteSyncStore().pending[0]).toMatchObject({ step: 'projection', event: { result: { commitId: 1 } } });
    expect(useFileHistoryStore().getHistoryStacks(root).revision).toBe(1);
    expect(() => requireProjectionReady('s1')).toThrow('等待会话投影同步');
    expect(mocks.emitWindowEvent).not.toHaveBeenCalled();
    expect(mocks.invalidateQueryCacheByProject).not.toHaveBeenCalled();
    mocks.synchronizeSessionCommit.mockResolvedValueOnce(receipt().sessionUpdates[0]);
    await retryPendingProjectSessionWrites('s1');
    expect(mocks.synchronizeSessionCommit).toHaveBeenLastCalledWith('s1', root, 1);
    expect(useWriteSyncStore().pending).toHaveLength(0);
    expect(() => requireProjectionReady('s1')).not.toThrow();
  });
  it('retries broadcast using the completed local acceptance and projection', async () => {
    mocks.emitWindowEvent.mockRejectedValueOnce(new Error('broadcast'));
    await expect(publishCommittedWrite(root, receipt(), 's1')).rejects.toThrow('broadcast');
    expect(useWriteSyncStore().pending[0]?.step).toBe('broadcast');
    expect(useFileHistoryStore().getHistoryStacks(root).revision).toBe(1);
    await retryPendingProjectSessionWrites('s1');
    expect(mocks.synchronizeSessionCommit).not.toHaveBeenCalled();
    expect(mocks.invalidateQueryCacheByProject).toHaveBeenCalledOnce();
    expect(mocks.emitWindowEvent).toHaveBeenCalledTimes(2);
  });
  it('shares a running operation for the same committed receipt', async () => {
    let release!: () => void;
    mocks.emitWindowEvent.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)));
    const written = receipt();
    const first = publishCommittedWrite(root, written, 's1');
    const second = publishCommittedWrite(root, written, 's1');
    expect(useWriteSyncStore().pending).toHaveLength(1);
    await vi.waitFor(() => expect(mocks.emitWindowEvent).toHaveBeenCalledOnce());
    release();
    await Promise.all([first, second]);
    expect(mocks.invalidateQueryCacheByProject).toHaveBeenCalledOnce();
  });
  it('deduplicates received receipts and keeps the highest manifest projection', async () => {
    const handler = vi.fn();
    const stop = await listenCommittedWrites(handler);
    const latest: CommittedWriteEvent = { originWindowLabel: 'peer', sessionId: 's1', modRoot: root, reason: 'save', result: receipt(2) };
    await mocks.handler!(latest);
    await mocks.handler!(latest);
    await mocks.handler!({ ...latest, result: receipt(1) });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(useProjectStore().getManifest(root)?.modInfo?.name).toBe('projection-2');
    expect(useFileHistoryStore().getHistoryStacks(root).revision).toBe(2);
    stop();
  });
  it('starts identity consumers before notifying dependent cache consumers', async () => {
    const sequence: string[] = [];
    mocks.invalidateQueryCacheByProject.mockImplementationOnce(() => sequence.push('cache'));
    await listenCommittedWrites(
      async () => {
        sequence.push('identity');
        await Promise.resolve();
        sequence.push('identity-ready');
      },
      () => true,
      'identity',
    );
    await listenCommittedWrites(async () => {
      sequence.push('projection');
    });
    await mocks.handler!({ originWindowLabel: 'peer', sessionId: 's1', modRoot: root, reason: 'save', result: receipt() });
    expect(sequence).toEqual(['identity', 'cache', 'identity-ready', 'projection']);
  });
  it('filters an older session before applying domain notifications', async () => {
    const handler = vi.fn();
    await listenCommittedWrites(handler);
    useProjectStore().removeProjectManifest(root);
    useProjectStore().registerProjectManifest(manifestFixture(root, 's2'));
    await mocks.handler!({ originWindowLabel: 'peer', sessionId: 's1', modRoot: root, reason: 'save', result: receipt() });
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.invalidateQueryCacheByProject).not.toHaveBeenCalled();
  });
  it('leaves the source window echo at the committed local state', async () => {
    const handler = vi.fn();
    await listenCommittedWrites(handler);
    const written = receipt();
    await publishCommittedWrite(root, written, 's1');
    await mocks.handler!({ originWindowLabel: 'main', sessionId: 's1', modRoot: root, reason: 'save', result: written });
    expect(handler).not.toHaveBeenCalled();
    expect(mocks.invalidateQueryCacheByProject).toHaveBeenCalledOnce();
  });
  it('ends a removed-session retry before accepting an older response', async () => {
    let restore!: (update: CommittedSessionUpdate) => void;
    mocks.synchronizeSessionCommit.mockImplementationOnce(() => new Promise((resolve) => (restore = resolve)));
    const syncing = publishCommittedWrite(root, receipt(1, false), 's1');
    useWriteSyncStore().removeModState(root);
    useProjectStore().removeProjectManifest(root);
    useProjectStore().registerProjectManifest(manifestFixture(root, 's2'));
    restore(receipt().sessionUpdates[0]!);
    await syncing;
    expect(useProjectStore().getSessionId(root)).toBe('s2');
    expect(mocks.emitWindowEvent).not.toHaveBeenCalled();
  });
  it('accepts zero-change credentials with the current projection', async () => {
    const written = { ...receipt(), changes: [] };
    await publishCommittedWrite(root, written, 's1');
    expect(useProjectStore().getManifest(root)?.modInfo?.name).toBe('projection-1');
    expect(mocks.emitWindowEvent).not.toHaveBeenCalled();
  });
  it('applies one received projection only once across consumers', () => {
    applyProjectSessionCacheInvalid(projection());
    applyProjectSessionCacheInvalid(projection());
    expect(mocks.invalidateQueryCacheByProject).toHaveBeenCalledOnce();
  });
});
