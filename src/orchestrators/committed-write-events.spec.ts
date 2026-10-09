import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommittedWriteEvent, EditorSpecKind, FileChangeRecord } from '@/shared/types';
import { savedWriteFixture, sessionUpdateFixture } from '@/test/write-result';
import { entityTargetFixture } from '@/test/entity-target';
const mocks = vi.hoisted(() => ({
  publish: vi.fn(),
  listeners: [] as Array<{ handler: (event: CommittedWriteEvent) => Promise<void>; phase: string | undefined }>,
}));
vi.mock('@/orchestrators/project-session-refresh.orchestrator', () => ({
  publishCommittedWrite: mocks.publish,
  listenCommittedWrites: async (handler: (event: CommittedWriteEvent) => Promise<void>, _matches?: unknown, phase?: string) => {
    const entry = { handler, phase };
    mocks.listeners.push(entry);
    return () => {
      mocks.listeners.splice(mocks.listeners.indexOf(entry), 1);
    };
  },
  listenProjectSessionInvalidated: vi.fn(),
}));
import { emitEditorSpecSaved, listenEditorSpecSaved } from './editor-window.orchestrator';
import { emitFileEditorSaved, listenFileEditorTextApplied } from './file-editor-window.orchestrator';
import { listenEntityIdentityApplied } from './entity-events.orchestrator';

function event(): CommittedWriteEvent {
  return { originWindowLabel: 'peer', sessionId: 's1', modRoot: 'M:/mod', reason: 'undo', result: savedWriteFixture() };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.length = 0;
  mocks.publish.mockResolvedValue(undefined);
});
describe('committed write domain projections', () => {
  it.each(['ship', 'weapon', 'projectile', 'system'] as EditorSpecKind[])(
    'publishes %s saves and projects their formal identity from one receipt',
    async (kind) => {
      const receipt = savedWriteFixture({ id: 'next', hullId: 'next' });
      receipt.identityChanges = [{ before: entityTargetFixture(kind, 'old'), after: entityTargetFixture(kind, 'next') }];
      const source = { sessionId: 's1', modRoot: 'M:/mod', kind, id: 'next', spec: receipt.refreshedEntity!, writeResult: receipt };
      await emitEditorSpecSaved(source);
      expect(mocks.publish).toHaveBeenCalledWith('M:/mod', receipt, 's1');
      const receive = vi.fn();
      await listenEditorSpecSaved(receive);
      await mocks.listeners[0]!.handler({ ...event(), result: receipt });
      expect(receive).toHaveBeenCalledWith(source);
    },
  );
  it('publishes generic text saves through the same commit owner', async () => {
    const receipt = savedWriteFixture({ text: 'text' });
    await emitFileEditorSaved({ modRoot: 'M:/mod', sessionId: 's1', path: 'M:/mod/notes.txt', writeResult: receipt });
    expect(mocks.publish).toHaveBeenCalledWith('M:/mod', receipt, 's1');
  });
  it('routes identified text saves through projection reads while retaining their text receipt', async () => {
    const receipt = savedWriteFixture({ text: '{hullId:"next"}' });
    receipt.identityChanges = [{ before: entityTargetFixture('ship', 'old'), after: entityTargetFixture('ship', 'next') }];
    const receive = vi.fn();
    await listenEditorSpecSaved(receive);
    await mocks.listeners[0]!.handler({ ...event(), result: receipt });
    expect(receive).not.toHaveBeenCalled();
  });
  it('follows replay identity before applying dependent projection consumers', async () => {
    const receipt = savedWriteFixture();
    receipt.identityChanges = [{ before: entityTargetFixture('variant', 'old'), after: entityTargetFixture('variant', 'next') }];
    const receive = vi.fn();
    const stop = await listenEntityIdentityApplied(receive);
    expect(mocks.listeners[0]!.phase).toBe('identity');
    await mocks.listeners[0]!.handler({ ...event(), result: receipt });
    expect(receive).toHaveBeenCalledWith({ sessionId: 's1', modRoot: 'M:/mod', result: receipt });
    stop();
    expect(mocks.listeners).toHaveLength(0);
  });
  it('projects directory replay text using the actual after paths and contents', async () => {
    const receipt = savedWriteFixture();
    receipt.sessionUpdates = [sessionUpdateFixture('s1', 'M:/mod')];
    const directory: FileChangeRecord = {
      kind: 'directory',
      beforePath: 'M:/mod/old',
      afterPath: 'M:/mod/next',
      beforeExists: true,
      beforeText: null,
      beforeDataBase64: null,
      beforeFiles: [{ relPath: 'gone.txt', text: 'before', dataBase64: null }],
      afterExists: true,
      afterText: null,
      afterDataBase64: null,
      afterFiles: [
        { relPath: 'new.txt', text: 'after', dataBase64: null },
        { relPath: 'image.png', text: null, dataBase64: 'AA==' },
      ],
    };
    receipt.changes = [directory];
    const receive = vi.fn();
    await listenFileEditorTextApplied(receive);
    await mocks.listeners[0]!.handler({ ...event(), result: receipt });
    expect(receive).toHaveBeenCalledTimes(2);
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ path: 'M:/mod/next\\gone.txt', text: '' }));
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ path: 'M:/mod/next\\new.txt', text: 'after' }));
  });
  it('projects recovery writes to their actual registered text-session scope', async () => {
    const receipt = savedWriteFixture({ text: 'recovered' });
    receipt.sessionUpdates = [sessionUpdateFixture('s1', 'M:/mod')];
    receipt.changes = [
      {
        kind: 'file',
        beforePath: 'M:/mod/notes.txt',
        afterPath: 'M:/mod/notes.txt',
        beforeExists: true,
        afterExists: true,
        beforeText: 'old',
        afterText: 'recovered',
        beforeDataBase64: null,
        afterDataBase64: null,
        beforeFiles: [],
        afterFiles: [],
      },
    ];
    const receive = vi.fn();
    await listenFileEditorTextApplied(receive);
    await mocks.listeners[0]!.handler({ ...event(), sessionId: null, result: receipt });
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1', modRoot: 'M:/mod', text: 'recovered' }));
  });
});
