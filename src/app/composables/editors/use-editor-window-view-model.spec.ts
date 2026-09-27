import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ShipEditorEntityBundle } from '@/services/editor.service';
import type { WriteResult } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  queryEditorEntityBundle: vi.fn(),
  saveEditorSpecByKind: vi.fn(),
  loadImportedSpecFile: vi.fn(),
  refreshBundleProjectiles: vi.fn(),
  refreshBundleResources: vi.fn(),
  emitEditorSpecSaved: vi.fn(async () => {}),
  pickEditorSpecFile: vi.fn(async () => null as string | null),
  closeCurrentWindow: vi.fn(async () => {}),
  feedback: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null as string | null),
  },
  specSavedHandler: { current: null as ((event: Record<string, unknown>) => void) | null },
}));

vi.mock('@/services/editor.service', () => ({
  queryEditorEntityBundle: mocks.queryEditorEntityBundle,
  loadImportedSpecFile: mocks.loadImportedSpecFile,
  refreshBundleProjectiles: mocks.refreshBundleProjectiles,
  refreshBundleResources: mocks.refreshBundleResources,
  saveEditorSpecByKind: mocks.saveEditorSpecByKind,
}));

vi.mock('@/orchestrators/editor-window.orchestrator', () => ({
  emitEditorSpecSaved: mocks.emitEditorSpecSaved,
  listenEditorSpecSaved: vi.fn(async (handler: never) => {
    mocks.specSavedHandler.current = handler as never;
    return async () => {};
  }),
}));

vi.mock('@/orchestrators/project-session-refresh.orchestrator', () => ({
  applyProjectSessionCacheInvalid: vi.fn(),
  listenProjectSessionInvalidated: vi.fn(async () => async () => {}),
}));

vi.mock('@/services/query-cache.service', () => ({
  hasEntityInvalidation: vi.fn(() => false),
  subscribeQueryInvalidations: vi.fn(() => () => {}),
}));

vi.mock('@/services/resource-cache.service', () => ({
  hasResourceInvalidation: vi.fn(() => false),
  subscribeResourceInvalidations: vi.fn(() => () => {}),
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

vi.mock('@/shared/runtime/dialog.runtime', () => ({
  pickEditorSpecFile: mocks.pickEditorSpecFile,
}));

vi.mock('@/windows/current.window', () => ({
  closeCurrentWindow: mocks.closeCurrentWindow,
}));

import { useEditorWindowViewModel } from './use-editor-window-view-model';
import type { RowData } from '@/shared/types';

function shipBundleFixture(isNew = false): ShipEditorEntityBundle {
  return { kind: 'ship', ship: { hullId: 'XY', hullName: 'Test Ship' }, resourceRefs: [], shipSpriteData: '', isNew };
}

function writeResultFixture(): WriteResult {
  return {
    changes: [],
    invalidation: { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false },
    keyMap: [],
    refreshedEntity: null,
  };
}

function createViewModel(kind = 'ship', draftSnapshot: RowData | null = null) {
  return useEditorWindowViewModel({ sessionId: 's1', modRoot: 'M:/mod', id: 'XY', kind: kind as never, draftSnapshot });
}

async function initializedViewModel(kind = 'ship', bundle = shipBundleFixture()) {
  mocks.queryEditorEntityBundle.mockResolvedValue(bundle);
  const viewModel = createViewModel(kind);
  await viewModel.initializeEditorWindow();
  if (kind !== 'weapon-preview') {
    await vi.waitFor(() =>
      expect(
        viewModel.shipEditorData.value ??
          viewModel.weaponEditorData.value ??
          viewModel.systemEditorData.value ??
          viewModel.projectileEditorData.value,
      ).not.toBeNull(),
    );
  }
  return viewModel;
}

describe('useEditorWindowViewModel save gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.specSavedHandler.current = null;
    mocks.feedback.choose.mockResolvedValue(null);
  });

  it('keeps the save disabled for a clean existing spec and enables it once dirty', async () => {
    const viewModel = await initializedViewModel();
    expect(viewModel.shipEditorData.value).not.toBeNull();
    expect(viewModel.canSaveSpec.value).toBe(false);

    viewModel.updateEditorDraft('ship', { hullId: 'XY', hullName: 'Edited' });
    expect(viewModel.draftDirty.value).toBe(true);
    expect(viewModel.canSaveSpec.value).toBe(true);
  });

  it('keeps the save disabled for read-only preview windows', async () => {
    mocks.queryEditorEntityBundle.mockResolvedValue({
      kind: 'weapon-preview',
      weapon: {},
      weaponCsvRow: {},
      projectileSpecs: {},
      resourceRefs: [],
      weaponSpriteData: {},
      isNew: false,
    });
    const viewModel = createViewModel('weapon-preview');
    await viewModel.initializeEditorWindow();
    expect(viewModel.canSaveSpec.value).toBe(false);
    viewModel.disposeEditorWindow();
  });

  it('enables the save for new specs even before edits', async () => {
    const viewModel = await initializedViewModel('ship', shipBundleFixture(true));
    expect(viewModel.canSaveSpec.value).toBe(true);
  });
});

describe('useEditorWindowViewModel saving', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.specSavedHandler.current = null;
    mocks.feedback.choose.mockResolvedValue(null);
  });

  it('writes the draft, broadcasts the saved event and commits the base', async () => {
    const result = writeResultFixture();
    mocks.saveEditorSpecByKind.mockResolvedValue(result);
    const viewModel = await initializedViewModel();

    viewModel.updateEditorDraft('ship', { hullId: 'XY', hullName: 'Saved Name' });
    await viewModel.saveEditorData('ship');

    expect(mocks.saveEditorSpecByKind).toHaveBeenCalledWith('s1', 'M:/mod', 'ship', 'XY', { hullId: 'XY', hullName: 'Saved Name' });
    expect(mocks.emitEditorSpecSaved).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'ship', sessionId: 's1', modRoot: 'M:/mod', id: 'XY', writeResult: result }),
    );
    expect(mocks.feedback.success).toHaveBeenCalledWith('XY 已保存');
    expect(viewModel.draftDirty.value).toBe(false);
    expect(viewModel.canSaveSpec.value).toBe(false);
  });

  it('reports save failures and keeps the draft editable', async () => {
    mocks.saveEditorSpecByKind.mockRejectedValue(new Error('write denied'));
    const viewModel = await initializedViewModel();
    viewModel.updateEditorDraft('ship', { hullId: 'XY' });
    await viewModel.saveEditorData('ship');
    expect(mocks.feedback.error).toHaveBeenCalledTimes(1);
    expect(viewModel.draftDirty.value).toBe(true);
  });

  it('ignores concurrent saves while one is in flight', async () => {
    let resolveSave: (value: WriteResult) => void = () => {};
    mocks.saveEditorSpecByKind.mockImplementation(
      () =>
        new Promise<WriteResult>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const viewModel = await initializedViewModel();
    viewModel.updateEditorDraft('ship', { hullId: 'XY' });
    const first = viewModel.saveEditorData('ship');
    await viewModel.saveEditorData('ship');
    resolveSave(writeResultFixture());
    await first;
    expect(mocks.saveEditorSpecByKind).toHaveBeenCalledTimes(1);
  });
});

describe('useEditorWindowViewModel missing specs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.specSavedHandler.current = null;
  });

  it('closes the window when the user cancels the missing-spec prompt', async () => {
    mocks.queryEditorEntityBundle.mockResolvedValue(shipBundleFixture(true));
    mocks.feedback.choose.mockResolvedValue(null);
    const viewModel = createViewModel();
    await viewModel.initializeEditorWindow();
    await vi.waitFor(() => expect(mocks.closeCurrentWindow).toHaveBeenCalledTimes(1));
    viewModel.disposeEditorWindow();
  });

  it('imports an existing file for a missing spec', async () => {
    mocks.queryEditorEntityBundle.mockResolvedValue(shipBundleFixture(true));
    mocks.feedback.choose.mockResolvedValue('import');
    mocks.pickEditorSpecFile.mockResolvedValue('C:/imports/XY.ship');
    mocks.loadImportedSpecFile.mockResolvedValue({ hullId: 'XY', hullName: 'Imported' });
    const viewModel = createViewModel();
    await viewModel.initializeEditorWindow();
    await vi.waitFor(() => expect(viewModel.shipEditorData.value?.ship).toEqual({ hullId: 'XY', hullName: 'Imported' }));
    expect(viewModel.canSaveSpec.value).toBe(false);
    expect(mocks.closeCurrentWindow).not.toHaveBeenCalled();
    viewModel.disposeEditorWindow();
  });

  it('keeps the default spec when the user chooses to create', async () => {
    mocks.queryEditorEntityBundle.mockResolvedValue(shipBundleFixture(true));
    mocks.feedback.choose.mockResolvedValue('create');
    const viewModel = createViewModel();
    await viewModel.initializeEditorWindow();
    await vi.waitFor(() => expect(viewModel.shipEditorData.value?.isNew).toBe(true));
    expect(viewModel.canSaveSpec.value).toBe(true);
    expect(mocks.closeCurrentWindow).not.toHaveBeenCalled();
    viewModel.disposeEditorWindow();
  });
});

describe('useEditorWindowViewModel external updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.specSavedHandler.current = null;
    mocks.feedback.choose.mockResolvedValue(null);
  });

  it('stages a conflicting external save as a pending external version', async () => {
    const viewModel = await initializedViewModel();
    viewModel.updateEditorDraft('ship', { hullId: 'XY', hullName: 'Local Edit' });

    await mocks.specSavedHandler.current!({
      kind: 'ship',
      sessionId: 's1',
      modRoot: 'M:/mod',
      id: 'XY',
      spec: { hullId: 'XY', hullName: 'Other Window' },
    });

    expect(viewModel.draftDirty.value).toBe(true);
    expect(viewModel.draftValue.value).toEqual({ hullId: 'XY', hullName: 'Local Edit' });
    expect(viewModel.externalUpdateNotice.value).toContain('外部版本已更新');
  });

  it('adopts an external save directly when the draft is clean', async () => {
    const viewModel = await initializedViewModel();
    await mocks.specSavedHandler.current!({
      kind: 'ship',
      sessionId: 's1',
      modRoot: 'M:/mod',
      id: 'XY',
      spec: { hullId: 'XY', hullName: 'External' },
    });
    expect(viewModel.draftValue.value).toEqual({ hullId: 'XY', hullName: 'External' });
    expect(viewModel.draftDirty.value).toBe(false);
    expect(viewModel.shipEditorData.value?.ship).toEqual({ hullId: 'XY', hullName: 'External' });
  });

  it('ignores saved events for other mods or targets', async () => {
    const viewModel = await initializedViewModel();
    await mocks.specSavedHandler.current!({ kind: 'ship', sessionId: 'other', modRoot: 'M:/mod', id: 'XY', spec: { hullId: 'XY' } });
    await mocks.specSavedHandler.current!({ kind: 'ship', sessionId: 's1', modRoot: 'M:/mod', id: 'ZZ', spec: { hullId: 'ZZ' } });
    expect(viewModel.draftValue.value).toEqual({ hullId: 'XY', hullName: 'Test Ship' });
  });

  it('loads the staged external version on demand', async () => {
    const viewModel = await initializedViewModel();
    viewModel.updateEditorDraft('ship', { hullId: 'XY', hullName: 'Local' });
    await mocks.specSavedHandler.current!({
      kind: 'ship',
      sessionId: 's1',
      modRoot: 'M:/mod',
      id: 'XY',
      spec: { hullId: 'XY', hullName: 'Remote' },
    });

    viewModel.loadPendingExternalSpec();
    expect(viewModel.draftValue.value).toEqual({ hullId: 'XY', hullName: 'Remote' });
    expect(viewModel.draftDirty.value).toBe(false);
    expect(viewModel.externalUpdateNotice.value).toBe('');
  });
});
