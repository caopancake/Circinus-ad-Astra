import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { savedWriteFixture } from '@/test/write-result';
import { entityTargetFixture } from '@/test/entity-target';

beforeEach(() => setActivePinia(createPinia()));

vi.mock('@/orchestrators/project-session-refresh.orchestrator', () => ({ applyCommittedWriteCacheInvalid: vi.fn() }));

const mocks = vi.hoisted(() => ({
  identityHandler: null as null | ((event: import('@/windows/window.events').EntityIdentityAppliedEvent) => Promise<void>),
  followIdentity: vi.fn(),
  loadEditableFileData: vi.fn(),
  writeEditableFileText: vi.fn(),
  emitFileEditorSaved: vi.fn(async () => {}),
  listenFileEditorProjectInvalidated: vi.fn(async (...args: unknown[]) => {
    void args;
    return async () => {};
  }),
  listenFileEditorFocusLine: vi.fn(async (...args: unknown[]) => {
    void args;
    return async () => {};
  }),
  listenFileEditorTextApplied: vi.fn(async (...args: unknown[]) => {
    void args;
    return async () => {};
  }),
  feedback: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null as string | null),
  },
}));

vi.mock('@/services/files.service', () => ({
  followFileTextIdentity: mocks.followIdentity,
  loadEditableFileData: mocks.loadEditableFileData,
  writeEditableFileText: mocks.writeEditableFileText,
}));
vi.mock('@/orchestrators/entity-identity.orchestrator', () => ({
  createEntitySavePreparation: async () => ({
    withPreparation: (_session: string, _root: string, _source: unknown, submit: (info: null) => Promise<unknown>) => submit(null),
    finish: vi.fn(async () => {}),
    dispose: vi.fn(),
  }),
  reserveFileIdentityIntent: vi.fn(async () => {}),
  releaseCommittedIdentityTargets: vi.fn(async () => {}),
  retargetFileWindow: vi.fn(async () => {}),
}));
vi.mock('@/orchestrators/entity-events.orchestrator', () => ({
  emitEntityIdentityApplied: vi.fn(async () => {}),
  listenEntityIdentityApplied: vi.fn(async (handler) => {
    mocks.identityHandler = handler;
    return () => {};
  }),
}));

vi.mock('@/orchestrators/file-editor-window.orchestrator', () => ({
  emitFileEditorSaved: mocks.emitFileEditorSaved,
  listenFileEditorFocusLine: mocks.listenFileEditorFocusLine,
  listenFileEditorTextApplied: mocks.listenFileEditorTextApplied,
  listenFileEditorProjectInvalidated: mocks.listenFileEditorProjectInvalidated,
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

import { useFileEditorViewModel, type FileEditorViewModelParams } from './use-file-editor-view-model';
import type { ProjectSessionInvalidatedEvent } from '@/windows/window.events';

function paramsFixture(overrides: Partial<FileEditorViewModelParams> = {}): FileEditorViewModelParams {
  return {
    mode: 'session',
    filePath: 'data/hulls/test.file',
    modRoot: 'C:/mods/alpha',
    sessionId: 's1',
    title: '文件编辑器',
    contextLabel: '信息',
    contextSeverity: 'info',
    contextMessage: '',
    line: null,
    column: null,
    ...overrides,
  };
}

async function initializeViewModel(params: FileEditorViewModelParams) {
  const viewModel = useFileEditorViewModel(params);
  await viewModel.initialize();
  return viewModel;
}

describe('useFileEditorViewModel loading', () => {
  it('loads the file text into the draft and tracks the line count', async () => {
    mocks.loadEditableFileData.mockResolvedValue({ path: 'x', text: 'line1\nline2', baseVersions: [] });
    const viewModel = await initializeViewModel(paramsFixture());
    expect(viewModel.text.value).toBe('line1\nline2');
    expect(viewModel.lineCount.value).toBe(2);
    expect(viewModel.dirty.value).toBe(false);
    viewModel.dispose();
  });

  it('reports load failures through feedback', async () => {
    mocks.loadEditableFileData.mockRejectedValue(new Error('unreadable'));
    const viewModel = await initializeViewModel(paramsFixture());
    expect(mocks.feedback.error).toHaveBeenCalledWith(expect.anything(), '打开文件失败');
    viewModel.dispose();
  });

  it('refuses to operate without a file path', async () => {
    const viewModel = await initializeViewModel(paramsFixture({ filePath: null }));
    expect(mocks.feedback.error).toHaveBeenCalledWith('缺少文件路径');
    expect(viewModel.text.value).toBe('');
    viewModel.dispose();
  });
});

describe('useFileEditorViewModel editing', () => {
  async function loadedViewModel() {
    mocks.loadEditableFileData.mockResolvedValue({ path: 'x', text: 'base', baseVersions: [] });
    return initializeViewModel(paramsFixture());
  }

  it('marks the draft dirty on edits and restores it on cancel', async () => {
    const viewModel = await loadedViewModel();
    viewModel.updateText('changed');
    expect(viewModel.dirty.value).toBe(true);
    viewModel.cancelChanges();
    expect(viewModel.dirty.value).toBe(false);
    expect(viewModel.text.value).toBe('base');
    viewModel.dispose();
  });

  it('ignores no-op text updates', async () => {
    const viewModel = await loadedViewModel();
    viewModel.updateText('base');
    expect(viewModel.dirty.value).toBe(false);
    expect(viewModel.canUndo.value).toBe(false);
    viewModel.dispose();
  });

  it('undoes and redoes text edits', async () => {
    const viewModel = await loadedViewModel();
    viewModel.updateText('changed');
    expect(viewModel.canUndo.value).toBe(true);
    viewModel.undoEdit();
    expect(viewModel.text.value).toBe('base');
    expect(viewModel.canRedo.value).toBe(true);
    viewModel.redoEdit();
    expect(viewModel.text.value).toBe('changed');
    viewModel.dispose();
  });

  it('saves through the write service and records history only in session mode', async () => {
    const result = {
      sessionUpdates: [],
      baseVersions: [],
      commitId: 1,
      history: { revision: 1, undoStack: [], redoStack: [] },
      changes: [],
      invalidation: {},
      identityChanges: [],
      keyMap: [],
      refreshedEntity: null,
    };
    mocks.writeEditableFileText.mockResolvedValue(result);
    const viewModel = await loadedViewModel();
    viewModel.updateText('saved text');
    await viewModel.saveFile();
    expect(mocks.writeEditableFileText).toHaveBeenCalledWith('s1', 'C:/mods/alpha', 'data/hulls/test.file', 'saved text', []);
    expect(mocks.emitFileEditorSaved).toHaveBeenCalledTimes(1);
    expect(mocks.feedback.success).toHaveBeenCalledWith('文件已保存');
    expect(viewModel.dirty.value).toBe(false);
    viewModel.dispose();
  });

  it('writes recovery credentials and publishes their actual associated session updates', async () => {
    mocks.loadEditableFileData.mockResolvedValue({ path: 'x', text: 'base', baseVersions: [] });
    const viewModel = await initializeViewModel(paramsFixture({ mode: 'recovery', sessionId: null }));
    mocks.writeEditableFileText.mockResolvedValue({
      sessionUpdates: [],
      baseVersions: [],
      commitId: 1,
      history: { revision: 1, undoStack: [], redoStack: [] },
      changes: [],
      invalidation: {},
      identityChanges: [],
      keyMap: [],
      refreshedEntity: null,
    });
    viewModel.updateText('recovered');
    await viewModel.saveFile();
    expect(mocks.writeEditableFileText).toHaveBeenCalledWith(null, 'C:/mods/alpha', 'data/hulls/test.file', 'recovered', []);
    expect(mocks.emitFileEditorSaved).toHaveBeenCalledWith(expect.objectContaining({ sessionId: null, modRoot: 'C:/mods/alpha' }));
    viewModel.dispose();
  });

  it('reports save failures and keeps the draft dirty', async () => {
    const viewModel = await loadedViewModel();
    mocks.writeEditableFileText.mockRejectedValue(new Error('locked'));
    viewModel.updateText('will fail');
    await viewModel.saveFile();
    expect(mocks.feedback.error).toHaveBeenCalledWith(expect.anything(), '保存文件失败');
    expect(viewModel.dirty.value).toBe(true);
    viewModel.dispose();
  });

  it('retains subsequent text and both history actions after accepting the written baseline', async () => {
    const vm = await loadedViewModel();
    let release!: (result: ReturnType<typeof savedWriteFixture>) => void;
    mocks.writeEditableFileText.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    vm.updateText('submitted');
    const writing = vm.saveFile();
    vm.updateText('later');
    release({ ...savedWriteFixture(), baseVersions: [{ path: 'file', fingerprint: 'v2' }] });
    await writing;
    expect(vm.text.value).toBe('later');
    expect(vm.dirty.value).toBe(true);
    vm.undoEdit();
    expect(vm.text.value).toBe('submitted');
    expect(vm.dirty.value).toBe(false);
    vm.undoEdit();
    expect(vm.text.value).toBe('base');
    expect(vm.dirty.value).toBe(true);
    expect(vm.externalTextNotice.value).toBe('');
    vm.dispose();
  });
});

describe('useFileEditorViewModel external text', () => {
  it('keeps unfinished text and follows its new identity after parsing becomes possible', async () => {
    const before = entityTargetFixture('ship', 'old');
    const after = entityTargetFixture('ship', 'new');
    mocks.loadEditableFileData.mockResolvedValueOnce({
      path: before.write.path,
      text: "{hullId:'old'}",
      baseVersions: [],
      entity: { target: before, baseVersions: [] },
    });
    const vm = await initializeViewModel(paramsFixture({ modRoot: 'M:/mod', filePath: before.write.path }));
    vm.updateText('{hullId:');
    mocks.feedback.choose.mockResolvedValueOnce('follow');
    mocks.followIdentity.mockRejectedValueOnce({
      code: 'parse.json_syntax',
      message: 'Unfinished text',
      location: { path: null, line: 1, column: 9 },
    });
    const result = savedWriteFixture();
    result.identityChanges = [{ before, after }];
    result.commitId = 10;
    await mocks.identityHandler!({ sessionId: 's1', modRoot: 'm:/MOD/', result });
    expect(vm.text.value).toBe('{hullId:');
    expect(vm.filePath.value).toBe(before.write.path);
    expect(vm.externalTextNotice.value).toContain('修正文本');
    expect(vm.targetColumn.value).toBe(9);
    mocks.followIdentity.mockResolvedValueOnce('{hullId:"new", extra: 2}');
    mocks.loadEditableFileData.mockResolvedValueOnce({
      path: after.write.path,
      text: '{hullId:"new"}',
      entity: { target: after, baseVersions: [] },
      baseVersions: [],
    });
    vm.updateText("{hullId:'old', extra: 2}");
    await vi.waitFor(() => expect(vm.filePath.value).toBe(after.write.path));
    expect(vm.text.value).toBe('{hullId:"new", extra: 2}');
    expect(vm.dirty.value).toBe(true);
    expect(vm.externalTextNotice.value).toBe('');
    expect(vm.canUndo.value).toBe(false);
    vm.dispose();
  });
  it('discards an external read superseded by the local save', async () => {
    mocks.loadEditableFileData.mockResolvedValueOnce({ path: 'C:/mods/alpha/notes.txt', text: 'base', baseVersions: [] });
    let invalidated!: (event: ProjectSessionInvalidatedEvent) => Promise<void>;
    mocks.listenFileEditorProjectInvalidated.mockImplementationOnce(async (handler: unknown) => {
      invalidated = handler as typeof invalidated;
      return async () => {};
    });
    const vm = await initializeViewModel(paramsFixture({ filePath: 'C:/mods/alpha/notes.txt' }));
    let release!: (loaded: { text: string; baseVersions: [] }) => void;
    mocks.loadEditableFileData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const reading = invalidated({
      manifest: { sessionId: 's1', modRoot: 'C:/mods/alpha' },
      invalidation: { paths: ['notes.txt'] },
    } as ProjectSessionInvalidatedEvent);
    vm.updateText('saved B');
    mocks.writeEditableFileText.mockResolvedValueOnce({ ...savedWriteFixture({ text: 'saved B' }), changes: [], baseVersions: [] });
    await vm.saveFile();
    release({ text: 'older A', baseVersions: [] });
    await reading;
    expect(vm.text.value).toBe('saved B');
    expect(vm.dirty.value).toBe(false);
    vm.dispose();
  });
  it.each(['data/hulls/test.file', 'data/hulls', 'C:/mods/alpha/data/hulls/test.file'])(
    'stages a dirty file version from the invalidation path %s',
    async (path) => {
      mocks.loadEditableFileData.mockResolvedValueOnce({ path: 'x', text: 'base', baseVersions: [] });
      let invalidated!: (event: ProjectSessionInvalidatedEvent) => Promise<void>;
      mocks.listenFileEditorProjectInvalidated.mockImplementationOnce(async (handler: unknown) => {
        invalidated = handler as typeof invalidated;
        return async () => {};
      });
      const viewModel = await initializeViewModel(paramsFixture({ filePath: 'C:/mods/alpha/data/hulls/test.file' }));
      viewModel.updateText('local');
      mocks.loadEditableFileData.mockResolvedValueOnce({ path: 'x', text: 'external', baseVersions: [] });
      await invalidated({
        manifest: { sessionId: 's1', modRoot: 'C:/mods/alpha' },
        invalidation: { paths: [path] },
      } as ProjectSessionInvalidatedEvent);
      expect(mocks.loadEditableFileData).toHaveBeenLastCalledWith('s1', 'C:/mods/alpha', 'C:/mods/alpha/data/hulls/test.file');
      expect(viewModel.text.value).toBe('local');
      expect(viewModel.hasPendingExternalText.value).toBe(true);
      viewModel.loadPendingExternalText();
      mocks.feedback.confirmWarning.mock.calls.at(-1)![0].onConfirm();
      expect(viewModel.text.value).toBe('external');
      viewModel.dispose();
    },
  );

  it('stages external text while dirty and shows the notice', async () => {
    mocks.loadEditableFileData.mockResolvedValue({ path: 'x', text: 'base', baseVersions: [] });
    let textApplied: ((event: { sessionId: string; modRoot: string; path: string; text: string; baseVersions: [] }) => void) | null = null;
    mocks.listenFileEditorTextApplied.mockImplementation(async (handler?: unknown) => {
      textApplied = handler as never;
      return async () => {};
    });
    const viewModel = await initializeViewModel(paramsFixture());
    viewModel.updateText('local edit');
    textApplied!({ sessionId: 's1', modRoot: 'C:/mods/alpha', path: 'data/hulls/test.file', text: 'external', baseVersions: [] });

    expect(viewModel.dirty.value).toBe(true);
    expect(viewModel.text.value).toBe('local edit');
    expect(viewModel.hasPendingExternalText.value).toBe(true);
    expect(viewModel.externalTextNotice.value).toContain('外部文本已更新');

    viewModel.loadPendingExternalText();
    mocks.feedback.confirmWarning.mock.calls.at(-1)![0].onConfirm();
    expect(viewModel.text.value).toBe('external');
    expect(viewModel.hasPendingExternalText.value).toBe(false);
    viewModel.dispose();
  });

  it('applies external text directly when clean and filters foreign targets', async () => {
    mocks.loadEditableFileData.mockResolvedValue({ path: 'x', text: 'base', baseVersions: [] });
    let textApplied: ((event: { sessionId: string; modRoot: string; path: string; text: string; baseVersions: [] }) => void) | null = null;
    mocks.listenFileEditorTextApplied.mockImplementation(async (handler?: unknown) => {
      textApplied = handler as never;
      return async () => {};
    });
    const viewModel = await initializeViewModel(paramsFixture());
    textApplied!({ sessionId: 'other', modRoot: 'C:/mods/alpha', path: 'data/hulls/test.file', text: 'foreign', baseVersions: [] });
    expect(viewModel.text.value).toBe('base');

    textApplied!({ sessionId: 's1', modRoot: 'C:/mods/alpha', path: 'data/hulls/test.file', text: 'fresh', baseVersions: [] });
    expect(viewModel.text.value).toBe('fresh');
    expect(viewModel.hasPendingExternalText.value).toBe(false);
    viewModel.dispose();
  });

  it('updates the error context from focus line events', async () => {
    mocks.loadEditableFileData.mockResolvedValue({ path: 'x', text: 'base', baseVersions: [] });
    let focusLine:
      | ((event: { message?: string; contextLabel?: string; contextSeverity?: string; line: number | null; column: number | null }) => void)
      | null = null;
    mocks.listenFileEditorFocusLine.mockImplementation(async (handler?: unknown) => {
      focusLine = handler as never;
      return async () => {};
    });
    const viewModel = await initializeViewModel(paramsFixture());
    focusLine!({ message: 'parse error', contextLabel: '错误', contextSeverity: 'error', line: 3, column: 2 });
    expect(viewModel.contextSeverity.value).toBe('error');
    expect(viewModel.isErrorContext.value).toBe(true);
    expect(viewModel.targetLine.value).toBe(3);
    expect(viewModel.targetColumn.value).toBe(2);
    viewModel.dispose();
  });
});
