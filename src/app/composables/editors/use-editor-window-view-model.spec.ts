import { entityTargetFixture } from '@/test/entity-target';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import ShipEditor from '@/app/components/editors/ShipEditor.vue';
import WeaponEditor from '@/app/components/editors/WeaponEditor.vue';
import { installCanvas2DStub } from '@/test/canvas-stub';
import { editorUiStubs } from '@/test/ui-stubs';
import { invalidateQueryCacheByProject } from '@/services/query-cache.service';
import { invalidateResourceCacheForSession } from '@/services/resource-cache.service';
import type { EditorEntityBundle, ShipEditorEntityBundle } from '@/services/editor.service';
import { listenEditorPreviewDraftUpdated } from '@/orchestrators/editor-window.orchestrator';
import type { WriteResult } from '@/shared/types';

const mocks = vi.hoisted(() => ({
  identityHandler: null as null | ((event: import('@/windows/window.events').EntityIdentityAppliedEvent) => Promise<void>),
  queryEditorEntityBundle: vi.fn(),
  saveEditorSpecByKind: vi.fn(),
  loadImportedSpecFile: vi.fn(),
  refreshBundleProjectiles: vi.fn(),
  refreshBundleResources: vi.fn(),
  queryDraftEditorImages: vi.fn(),
  emitEditorSpecSaved: vi.fn(async () => {}),
  previewDraftHandler: { current: null as ((event: Record<string, unknown>) => void) | null },
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
  queryDraftEditorImages: mocks.queryDraftEditorImages,
  saveEditorSpecByKind: mocks.saveEditorSpecByKind,
}));
vi.mock('@/orchestrators/entity-identity.orchestrator', () => ({
  createEntitySavePreparation: async () => ({
    withPreparation: (_session: string, _root: string, _source: unknown, submit: (info: null) => Promise<unknown>) => submit(null),
    finish: vi.fn(async () => {}),
    dispose: vi.fn(),
  }),
  reserveEntityIntent: async (_session: string, _root: string, source: import('@/shared/types').EntityEditTarget, draft: RowData) => ({
    source,
    nextId: draft.hullId ?? draft.id,
    destinationVersion: { path: source.write.path, fingerprint: 'destination' },
    nextWrite: source.write,
  }),
  retargetEntityWindow: vi.fn(async () => {}),
  releaseCommittedIdentityTargets: vi.fn(async () => {}),
}));
vi.mock('@/orchestrators/entity-events.orchestrator', () => ({
  emitEntityIdentityApplied: vi.fn(async () => {}),
  listenEntityIdentityApplied: vi.fn(async (handler) => {
    mocks.identityHandler = handler;
    return () => {};
  }),
}));

vi.mock('@/orchestrators/editor-window.orchestrator', () => ({
  emitEditorSpecSaved: mocks.emitEditorSpecSaved,
  listenEditorSpecSaved: vi.fn(async (handler: never) => {
    mocks.specSavedHandler.current = handler as never;
    return async () => {};
  }),
  listenEditorPreviewDraftUpdated: vi.fn(async (handler: never) => {
    mocks.previewDraftHandler.current = handler as never;
    return async () => {};
  }),
}));

vi.mock('@/orchestrators/project-session-refresh.orchestrator', () => ({
  applyProjectSessionCacheInvalid: vi.fn(),
  applyCommittedWriteCacheInvalid: vi.fn(),
  listenProjectSessionInvalidated: vi.fn(async () => async () => {}),
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

vi.mock('@/orchestrators/json-write-confirmation.orchestrator', () => ({
  runConfirmedJsonWrite: (_feedback: unknown, write: (options: unknown) => Promise<unknown>) =>
    write({ preserveOriginalJson: true, confirmedSources: [] }),
}));

vi.mock('@/shared/runtime/dialog.runtime', () => ({
  pickEditorSpecFile: mocks.pickEditorSpecFile,
  pickImageFileDialog: vi.fn(async () => null),
  pickFileDialog: vi.fn(async () => null),
}));

vi.mock('@/windows/current.window', () => ({
  closeCurrentWindow: mocks.closeCurrentWindow,
}));

import { useEditorWindowViewModel } from './use-editor-window-view-model';
import type { RowData } from '@/shared/types';

function shipBundleFixture(isNew = false): ShipEditorEntityBundle {
  return {
    baseVersions: [],
    target: entityTargetFixture('ship', 'XY', isNew ? 'create' : 'existing'),
    kind: 'ship',
    ship: { hullId: 'XY', hullName: 'Test Ship' },
    resourceRefs: [],
    shipSpriteData: '',
    isNew,
  };
}

function writeResultFixture(refreshedEntity: RowData = { hullId: 'XY' }): WriteResult {
  return {
    sessionUpdates: [],
    baseVersions: [],
    commitId: 1,
    history: { revision: 1, undoStack: [], redoStack: [] },
    changes: [],
    invalidation: { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false },
    identityChanges: [{ before: entityTargetFixture('ship', 'XY'), after: entityTargetFixture('ship', 'XY') }],
    keyMap: [],
    refreshedEntity,
  };
}

const viewModels: ReturnType<typeof useEditorWindowViewModel>[] = [];
beforeEach(() => {
  setActivePinia(createPinia());
  mocks.refreshBundleProjectiles.mockImplementation(async (_session: string, bundle: EditorEntityBundle) => bundle);
  mocks.queryDraftEditorImages.mockImplementation(async (_session: string, kind: string, _id: string, draft: RowData) => {
    const field = kind === 'ship' ? 'spriteName' : 'turretSprite';
    const path = draft[field];
    return {
      resourceRefs: path ? [{ source: 'mod', ownerKind: kind, ownerId: 'XY', key: kind === 'ship' ? 'sprite' : field, relPath: path }] : [],
      shipSpriteData: kind === 'ship' ? (path ?? '') : '',
      weaponSpriteData: kind === 'weapon' && path ? { [field]: path } : {},
    };
  });
});
afterEach(() => {
  for (const vm of viewModels.splice(0)) vm.disposeEditorWindow();
});

function createViewModel(kind = 'ship', draftSnapshot: RowData | null = null) {
  const vm = useEditorWindowViewModel({ sessionId: 's1', modRoot: 'M:/mod', id: 'XY', kind: kind as never, draftSnapshot });
  viewModels.push(vm);
  return vm;
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
  it('keeps the preview instance attached to the renamed weapon', async () => {
    const bundle = {
      kind: 'weapon-preview' as const,
      target: entityTargetFixture('weapon', 'XY'),
      baseVersions: [],
      weapon: { id: 'XY', specClass: 'beam' },
      weaponCsvRow: {},
      projectileSpecs: {},
      resourceRefs: [],
      weaponSpriteData: {},
      isNew: false,
    };
    mocks.queryEditorEntityBundle.mockResolvedValueOnce(bundle);
    const vm = createViewModel('weapon-preview');
    await vm.initializeEditorWindow();
    await flushPromises();
    const next = { ...bundle, target: entityTargetFixture('weapon', 'next'), weapon: { id: 'next', specClass: 'beam' } };
    mocks.queryEditorEntityBundle.mockResolvedValueOnce(next);
    const result = writeResultFixture();
    result.identityChanges = [{ before: bundle.target, after: next.target }];
    result.commitId = 8;
    await mocks.identityHandler!({ sessionId: 's1', modRoot: 'M:/mod', result });
    expect(vm.currentTarget.value?.id).toBe('next');
    expect(vm.weaponPreviewData.value?.weapon.id).toBe('next');
    expect(vm.canSaveSpec.value).toBe(false);
  });
  it('accepts a dirty identity handoff while preserving the draft and raw inputs', async () => {
    const vm = await initializedViewModel();
    vm.updateEditorDraft('ship', { hullId: 'XY', hullName: 'Local' });
    mocks.feedback.choose.mockResolvedValueOnce('follow');
    const next = { ...shipBundleFixture(), target: entityTargetFixture('ship', 'next'), ship: { hullId: 'next', hullName: 'External' } };
    mocks.queryEditorEntityBundle.mockResolvedValueOnce(next);
    const result = writeResultFixture();
    result.identityChanges = [{ before: entityTargetFixture('ship', 'XY'), after: next.target }];
    result.commitId = 9;
    await mocks.identityHandler!({ sessionId: 's1', modRoot: 'm:/MOD/', result });
    expect(vm.currentTarget.value?.id).toBe('next');
    expect(vm.draftValue.value).toEqual({ hullId: 'next', hullName: 'Local' });
    expect(vm.draftDirty.value).toBe(true);
    expect(vm.editContext.value?.handoff).toBe('external');
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.specSavedHandler.current = null;
    mocks.previewDraftHandler.current = null;
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
      baseVersions: [],
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

  it('reloads a reused preview window with the latest draft snapshot', async () => {
    mocks.queryEditorEntityBundle.mockResolvedValue({
      baseVersions: [],
      kind: 'weapon-preview',
      weapon: { id: 'XY', projectileSpecId: 'proj_a' },
      weaponCsvRow: {},
      projectileSpecs: { proj_a: { id: 'proj_a' } },
      resourceRefs: [],
      weaponSpriteData: {},
      isNew: false,
    });
    const viewModel = createViewModel('weapon-preview', { id: 'XY', projectileSpecId: 'proj_a' });
    await viewModel.initializeEditorWindow();
    await mocks.previewDraftHandler.current!({
      sessionId: 's1',
      modRoot: 'M:/mod',
      id: 'XY',
      draft: { id: 'XY', projectileSpecId: 'proj_b' },
    });
    await vi.waitFor(() =>
      expect(mocks.queryEditorEntityBundle).toHaveBeenLastCalledWith('s1', 'weapon-preview', 'XY', {
        id: 'XY',
        projectileSpecId: 'proj_b',
      }),
    );
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
    mocks.previewDraftHandler.current = null;
    mocks.feedback.choose.mockResolvedValue(null);
  });

  it.each(['ship', 'weapon'] as const)('refreshes %s draft images and discards an older response', async (kind) => {
    const resource = {
      source: 'mod' as const,
      relPath: 'graphics/old.png',
      ownerKind: kind,
      ownerId: 'XY',
      key: kind === 'ship' ? 'sprite' : 'turretSprite',
    };
    const bundle =
      kind === 'ship'
        ? {
            ...shipBundleFixture(),
            ship: { hullId: 'XY', spriteName: 'graphics/old.png' },
            resourceRefs: [resource],
            shipSpriteData: 'old',
          }
        : {
            kind,
            baseVersions: [],
            isNew: false,
            weapon: { id: 'XY', turretSprite: 'graphics/old.png' },
            weaponCsvRow: {},
            projectileSpecs: {},
            projectileOptions: [],
            resourceRefs: [resource],
            weaponSpriteData: { turretSprite: 'old' },
          };
    mocks.queryEditorEntityBundle.mockResolvedValue(bundle);
    const vm = createViewModel(kind);
    await vm.initializeEditorWindow();
    await vi.waitFor(() => expect(vm.loading.value).toBe(false));
    const releases: Array<(images: unknown) => void> = [];
    mocks.queryDraftEditorImages.mockImplementation(
      () =>
        new Promise((resolve) => {
          releases.push(resolve);
        }),
    );
    const draft = (path: string): RowData => (kind === 'ship' ? { hullId: 'XY', spriteName: path } : { id: 'XY', turretSprite: path });
    vm.updateEditorDraft(kind, draft('graphics/first.png'));
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    vm.updateEditorDraft(kind, draft('graphics/latest.png'));
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    releases[1]!({
      resourceRefs: [{ ...resource, relPath: 'graphics/latest.png' }],
      shipSpriteData: 'latest',
      weaponSpriteData: { turretSprite: 'latest' },
    });
    await vi.waitFor(() =>
      expect(kind === 'ship' ? vm.shipSpriteForEditor.value : vm.weaponEditorData.value?.weaponSpriteData.turretSprite).toBe('latest'),
    );
    releases[0]!({
      resourceRefs: [{ ...resource, relPath: 'graphics/first.png' }],
      shipSpriteData: 'first',
      weaponSpriteData: { turretSprite: 'first' },
    });
    await Promise.resolve();
    expect(kind === 'ship' ? vm.shipSpriteForEditor.value : vm.weaponEditorData.value?.weaponSpriteData.turretSprite).toBe('latest');
    vm.disposeEditorWindow();
  });

  it('writes the draft, broadcasts the saved event and commits the base', async () => {
    const result = writeResultFixture({ hullId: 'XY', hullName: 'Saved Name' });
    mocks.saveEditorSpecByKind.mockResolvedValue(result);
    const viewModel = await initializedViewModel();

    viewModel.updateEditorDraft('ship', { hullId: 'XY', hullName: 'Saved Name' });
    await viewModel.saveEditorData('ship');

    expect(mocks.saveEditorSpecByKind).toHaveBeenCalledWith(
      's1',
      'M:/mod',
      entityTargetFixture('ship', 'XY'),
      { hullId: 'XY', hullName: 'Saved Name' },
      { preserveOriginalJson: true, confirmedSources: [] },
      [{ path: 'M:/mod/data/hulls/XY.ship', fingerprint: 'destination' }],
    );
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

  it('keeps the loaded spec credential when preparation queries the same destination again', async () => {
    const bundle = shipBundleFixture();
    const baseVersions = [{ path: bundle.target.write.path, fingerprint: 'loaded-spec' }];
    mocks.saveEditorSpecByKind.mockResolvedValue(writeResultFixture({ hullId: 'XY', hullName: 'Saved' }));
    const vm = await initializedViewModel('ship', { ...bundle, baseVersions });
    vm.updateEditorDraft('ship', { hullId: 'XY', hullName: 'Saved' });
    await vm.saveEditorData('ship');
    expect(mocks.saveEditorSpecByKind.mock.lastCall?.[5]).toEqual(baseVersions);
  });

  it('keeps companion reads independent from images and rejects superseded dependencies and peer events', async () => {
    const weapon = { id: 'XY', specClass: 'projectile', projectileSpecId: 'A', turretSprite: 'graphics/ship.png' };
    mocks.queryEditorEntityBundle.mockResolvedValue({
      kind: 'weapon',
      weapon,
      baseVersions: [],
      isNew: false,
      weaponCsvRow: {},
      projectileSpecs: { A: { id: 'A' } },
      projectileOptions: [],
      resourceRefs: [],
      weaponSpriteData: {},
    });
    const vm = createViewModel('weapon');
    await vm.initializeEditorWindow();
    await flushPromises();
    const requests: Array<{ bundle: EditorEntityBundle; release: (bundle: EditorEntityBundle) => void }> = [];
    mocks.refreshBundleProjectiles.mockImplementation(
      (_session: string, bundle: EditorEntityBundle) =>
        new Promise((release) => {
          requests.push({ bundle, release });
        }),
    );
    vm.updateEditorDraft('weapon', { ...weapon, projectileSpecId: 'B' });
    expect(requests).toHaveLength(1);
    invalidateResourceCacheForSession('s1');
    await flushPromises();
    const first = requests[0]!;
    if (first.bundle.kind !== 'weapon') throw new Error('weapon expected');
    first.release({ ...first.bundle, projectileSpecs: { B: { id: 'B' } } });
    await flushPromises();
    expect(vm.weaponEditorData.value?.projectileSpecs).toEqual({ B: { id: 'B' } });
    expect(vm.weaponEditorData.value?.weaponSpriteData.turretSprite).toBe('graphics/ship.png');
    vm.updateEditorDraft('weapon', { ...weapon, projectileSpecId: 'C' });
    vm.updateEditorDraft('weapon', { ...weapon, projectileSpecId: 'D' });
    expect(requests).toHaveLength(3);
    const current = requests[2]!;
    const obsolete = requests[1]!;
    if (current.bundle.kind !== 'weapon' || obsolete.bundle.kind !== 'weapon') throw new Error('weapon expected');
    current.release({ ...current.bundle, projectileSpecs: { D: { id: 'D', length: 10 } } });
    obsolete.release({ ...obsolete.bundle, projectileSpecs: { C: { id: 'C' } } });
    await flushPromises();
    expect(vm.weaponEditorData.value?.projectileSpecs).toEqual({ D: { id: 'D', length: 10 } });
    const peer = (commitId: number, length: number) =>
      mocks.specSavedHandler.current!({
        kind: 'projectile',
        id: 'D',
        sessionId: 's1',
        modRoot: 'M:/mod',
        spec: { id: 'D', length },
        writeResult: { ...writeResultFixture(), commitId },
      });
    peer(20, 20);
    peer(19, 19);
    expect(vm.weaponEditorData.value?.projectileSpecs.D).toEqual({ id: 'D', length: 20 });
  });

  it('releases a listener whose registration completes after disposal', async () => {
    let release!: (stop: () => void) => void;
    const stop = vi.fn();
    vi.mocked(listenEditorPreviewDraftUpdated).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const vm = createViewModel();
    const initializing = vm.initializeEditorWindow();
    await flushPromises();
    vm.disposeEditorWindow();
    release(stop);
    await initializing;
    expect(stop).toHaveBeenCalledOnce();
    expect(mocks.queryEditorEntityBundle).not.toHaveBeenCalled();
  });

  it('accepts the projectile catalog independently while the draft reference changes', async () => {
    const weapon = { id: 'XY', projectileSpecId: 'A' };
    mocks.queryEditorEntityBundle.mockResolvedValue({
      kind: 'weapon',
      weapon,
      baseVersions: [],
      isNew: false,
      weaponCsvRow: {},
      projectileSpecs: { A: { id: 'A' } },
      projectileOptions: [],
      resourceRefs: [],
      weaponSpriteData: {},
    });
    const vm = createViewModel('weapon');
    await vm.initializeEditorWindow();
    await flushPromises();
    let releaseCatalog!: (bundle: EditorEntityBundle) => void;
    let catalog!: EditorEntityBundle;
    mocks.refreshBundleProjectiles.mockImplementation(
      (_session: string, bundle: EditorEntityBundle, options: { projectileSpecs: boolean; projectileOptions: boolean }) => {
        if (options.projectileOptions) {
          catalog = bundle;
          return new Promise((resolve) => {
            releaseCatalog = resolve;
          });
        }
        return Promise.resolve({ ...bundle, projectileSpecs: { B: { id: 'B' } } });
      },
    );
    invalidateQueryCacheByProject('s1', {
      paths: [],
      tables: [],
      entities: [],
      resources: [],
      session: false,
      queryScopes: [{ kind: 'entity-list', entity: { kind: 'projectile', id: null }, table: null, source: null, resource: null }],
    });
    vm.updateEditorDraft('weapon', { ...weapon, projectileSpecId: 'B' });
    await flushPromises();
    if (catalog.kind !== 'weapon') throw new Error('weapon expected');
    releaseCatalog({ ...catalog, projectileOptions: [{ label: 'B', value: 'B' }] });
    await flushPromises();
    expect(vm.weaponEditorData.value?.projectileSpecs).toEqual({ B: { id: 'B' } });
    expect(vm.weaponEditorData.value?.projectileOptions).toEqual([{ label: 'B', value: 'B' }]);
    expect(vm.draftValue.value.projectileSpecId).toBe('B');
  });

  it('accepts canonical content before broadcast failure and recognizes its later echo', async () => {
    const vm = await initializedViewModel('ship', shipBundleFixture(true));
    const result = writeResultFixture({ hullId: 'XY', hullName: 'Canonical' });
    mocks.saveEditorSpecByKind.mockResolvedValueOnce(result);
    mocks.emitEditorSpecSaved.mockRejectedValueOnce(new Error('broadcast failed'));
    vm.updateEditorDraft('ship', { hullId: 'XY', hullName: 'Raw' });
    const writing = vm.saveEditorData('ship');
    const waiting = vm.waitForSave();
    await writing;
    expect(await waiting).toBe(false);
    expect(vm.draftValue.value).toEqual(result.refreshedEntity);
    expect(vm.shipEditorData.value?.isNew).toBe(false);
    expect(vm.draftDirty.value).toBe(false);
    expect(mocks.feedback.error).toHaveBeenCalledWith(expect.objectContaining({ action: 'sync-saved-target' }));
    vm.updateEditorDraft('ship', { hullId: 'XY', hullName: 'Later' });
    await mocks.specSavedHandler.current!({
      kind: 'ship',
      sessionId: 's1',
      modRoot: 'M:/mod',
      id: 'XY',
      spec: result.refreshedEntity,
      writeResult: result,
    });
    expect(vm.draftValue.value.hullName).toBe('Later');
    expect(vm.externalUpdateNotice.value).toBe('');
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
    const second = viewModel.saveEditorData('ship');
    await flushPromises();
    resolveSave(writeResultFixture());
    await Promise.all([first, second]);
    expect(mocks.saveEditorSpecByKind).toHaveBeenCalledTimes(1);
  });
});

describe('useEditorWindowViewModel missing specs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.specSavedHandler.current = null;
    mocks.previewDraftHandler.current = null;
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
    expect(viewModel.canSaveSpec.value).toBe(true);
    expect(viewModel.draftDirty.value).toBe(true);
    mocks.saveEditorSpecByKind.mockResolvedValue(writeResultFixture({ hullId: 'XY', hullName: 'Imported' }));
    await viewModel.saveEditorData('ship');
    expect(mocks.saveEditorSpecByKind).toHaveBeenCalledWith(
      's1',
      'M:/mod',
      entityTargetFixture('ship', 'XY', 'create'),
      { hullId: 'XY', hullName: 'Imported' },
      { preserveOriginalJson: true, confirmedSources: [] },
      [{ path: 'M:/mod/data/hulls/XY.ship', fingerprint: 'destination' }],
    );
    expect(viewModel.draftDirty.value).toBe(false);
    expect(viewModel.shipEditorData.value?.isNew).toBe(false);
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
      writeResult: writeResultFixture(),
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
      writeResult: writeResultFixture(),
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
      writeResult: writeResultFixture(),
    });

    viewModel.loadPendingExternalSpec();
    mocks.feedback.confirmWarning.mock.calls.at(-1)![0].onConfirm();
    expect(viewModel.draftValue.value).toEqual({ hullId: 'XY', hullName: 'Remote' });
    expect(viewModel.draftDirty.value).toBe(false);
    expect(viewModel.externalUpdateNotice.value).toBe('');
  });
});

describe.each(['ship', 'weapon'] as const)('%s draft resource lifecycle', (kind) => {
  const field = kind === 'ship' ? 'spriteName' : 'turretSprite';
  const spec = (path: string): RowData => ({ hullId: 'XY', id: 'XY', [field]: path });
  const images = (path: string) => ({
    resourceRefs: [{ source: 'mod', ownerKind: kind, ownerId: 'XY', key: kind === 'ship' ? 'sprite' : field, relPath: path }],
    shipSpriteData: path,
    weaponSpriteData: { [field]: path },
  });
  const bundle = (path: string) =>
    kind === 'ship'
      ? { ...shipBundleFixture(), ...images(path), ship: spec(path) }
      : {
          kind,
          baseVersions: [],
          isNew: false,
          weapon: spec(path),
          weaponCsvRow: {},
          projectileSpecs: {},
          projectileOptions: [],
          ...images(path),
        };

  function invalidateDetail() {
    invalidateQueryCacheByProject('s1', {
      paths: [],
      tables: [],
      entities: [],
      resources: [],
      session: false,
      queryScopes: [{ kind: 'entity-detail', entity: { kind, id: 'XY' }, table: null, source: null, resource: null }],
    });
  }

  async function open() {
    mocks.queryEditorEntityBundle.mockResolvedValue(bundle('old.png'));
    const vm = createViewModel(kind);
    await vm.initializeEditorWindow();
    await flushPromises();
    return vm;
  }

  function expectImage(vm: ReturnType<typeof createViewModel>, path: string) {
    expect(vm.draftValue.value[field]).toBe(path);
    const data = kind === 'ship' ? vm.shipEditorData.value! : vm.weaponEditorData.value!;
    expect(data.resourceRefs[0]?.relPath).toBe(path);
    expect(kind === 'ship' ? vm.shipSpriteForEditor.value : vm.weaponEditorData.value!.weaponSpriteData[field]).toBe(path);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.feedback.choose.mockResolvedValue(null);
  });

  it('keeps draft resources after a real detail cache invalidation', async () => {
    const vm = await open();
    vm.updateEditorDraft(kind, spec('new.png'));
    await flushPromises();
    expectImage(vm, 'new.png');
    invalidateDetail();
    await flushPromises();
    expectImage(vm, 'new.png');
    expect(vm.draftDirty.value).toBe(true);
    expect(vm.externalUpdateNotice.value).toBe('');
    expect(mocks.queryDraftEditorImages).toHaveBeenLastCalledWith('s1', kind, 'XY', spec('new.png'));
  });

  it('uses edits made during a detail query and ignores its older image response', async () => {
    const vm = await open();
    vm.updateEditorDraft(kind, spec('new.png'));
    await flushPromises();
    let releaseDetail!: (value: unknown) => void;
    mocks.queryEditorEntityBundle.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseDetail = resolve;
        }),
    );
    invalidateDetail();
    await flushPromises();
    vm.updateEditorDraft(kind, spec('later.png'));
    await flushPromises();
    expectImage(vm, 'later.png');
    releaseDetail(bundle('old.png'));
    await flushPromises();
    expect(vm.draftValue.value[field]).toBe('later.png');
    expectImage(vm, 'later.png');
    vm.updateEditorDraft(kind, spec('latest.png'));
    await flushPromises();
    expectImage(vm, 'latest.png');
    expectImage(vm, 'latest.png');
  });

  it('clears a failed resource projection and retries on resource invalidation', async () => {
    const vm = await open();
    mocks.queryDraftEditorImages.mockRejectedValueOnce(new Error('image failed'));
    vm.updateEditorDraft(kind, spec('new.png'));
    await flushPromises();
    expect(vm.editorData.value).toMatchObject({ resourceRefs: [] });
    expect(kind === 'ship' ? vm.shipSpriteForEditor.value : (vm.weaponEditorData.value!.weaponSpriteData[field] ?? '')).toBe('');
    expect(mocks.feedback.error).toHaveBeenCalledTimes(1);
    invalidateResourceCacheForSession('s1');
    await flushPromises();
    expectImage(vm, 'new.png');
  });

  it('loads resources for clean external saves and explicitly accepted pending data', async () => {
    const vm = await open();
    let commitId = 0;
    const external = (path: string) =>
      mocks.specSavedHandler.current!({
        kind,
        sessionId: 's1',
        modRoot: 'M:/mod',
        id: 'XY',
        spec: spec(path),
        writeResult: { ...writeResultFixture(), commitId: ++commitId },
      });
    external('external.png');
    await flushPromises();
    expectImage(vm, 'external.png');
    vm.updateEditorDraft(kind, spec('local.png'));
    await flushPromises();
    external('pending.png');
    await flushPromises();
    expectImage(vm, 'local.png');
    vm.loadPendingExternalSpec();
    mocks.feedback.confirmWarning.mock.calls.at(-1)![0].onConfirm();
    await flushPromises();
    expectImage(vm, 'pending.png');
    expect(vm.draftDirty.value).toBe(false);
  });

  it('resolves imported image fields through the draft query', async () => {
    mocks.queryEditorEntityBundle.mockResolvedValue({ ...bundle('old.png'), isNew: true });
    mocks.feedback.choose.mockResolvedValue('import');
    mocks.pickEditorSpecFile.mockResolvedValue('M:/imported.spec');
    mocks.loadImportedSpecFile.mockResolvedValue(spec('imported.png'));
    const vm = createViewModel(kind);
    await vm.initializeEditorWindow();
    await flushPromises();
    expectImage(vm, 'imported.png');
    expect(vm.draftDirty.value).toBe(true);
  });

  it('keeps the actual canvas component on the draft image after refresh', async () => {
    setActivePinia(createPinia());
    installCanvas2DStub();
    const sources: string[] = [];
    vi.stubGlobal(
      'Image',
      class {
        width = 64;
        height = 32;
        naturalWidth = 64;
        naturalHeight = 32;
        complete = true;
        onload: (() => void) | null = null;
        current = '';
        get src() {
          return this.current;
        }
        set src(path: string) {
          this.current = path;
          sources.push(path);
          if (path) queueMicrotask(() => this.onload?.());
        }
      },
    );
    const vm = await open();
    const wrapper = mount(
      {
        setup() {
          return () => {
            const common = {
              modRoot: 'M:/mod',
              sessionId: 's1',
              editContext: vm.editContext.value,
              dirty: vm.draftDirty.value,
              canSave: vm.canSaveSpec.value,
              saving: vm.draftSaving.value,
              externalUpdateNotice: vm.externalUpdateNotice.value,
              onDraftChanged: (draft: RowData) => vm.updateEditorDraft(kind, draft),
            };
            return kind === 'ship'
              ? h(ShipEditor, { ...common, hullId: 'XY', ship: vm.shipEditorData.value!.ship, spriteData: vm.shipSpriteForEditor.value })
              : h(WeaponEditor, {
                  ...common,
                  weaponId: 'XY',
                  weapon: vm.weaponForEditor.value,
                  spriteData: vm.weaponEditorData.value!.weaponSpriteData,
                  projectileOptions: [],
                });
          };
        },
      },
      { global: { stubs: editorUiStubs }, attachTo: document.body },
    );
    try {
      const pathInput = wrapper.findAll('input').find((input) => (input.element as HTMLInputElement).value === 'old.png');
      expect(pathInput).toBeDefined();
      await pathInput!.setValue('new.png');
      await flushPromises();
      expect(sources).toContain('new.png');
      sources.length = 0;
      invalidateDetail();
      await flushPromises();
      expect(sources.filter(Boolean)).toEqual(['new.png']);
      expect(wrapper.find('canvas.editor-canvas').exists()).toBe(true);
      if (kind === 'ship') {
        const sync = wrapper.findAll('button').find((button) => button.text() === '更新贴图宽高');
        expect(sync).toBeDefined();
        await sync!.trigger('click');
        await flushPromises();
        expect(vm.draftValue.value).toMatchObject({ spriteName: 'new.png', width: 64, height: 32 });
      }
    } finally {
      wrapper.unmount();
      vi.unstubAllGlobals();
    }
  });

  it('ignores detail and image completions after disposal', async () => {
    const vm = await open();
    let releaseImage!: (value: unknown) => void;
    let releaseDetail!: (value: unknown) => void;
    mocks.queryDraftEditorImages.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseImage = resolve;
        }),
    );
    vm.updateEditorDraft(kind, spec('new.png'));
    await flushPromises();
    mocks.queryEditorEntityBundle.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseDetail = resolve;
        }),
    );
    invalidateDetail();
    await flushPromises();
    vm.disposeEditorWindow();
    const before = vm.editorData.value;
    releaseImage(images('new.png'));
    releaseDetail(bundle('old.png'));
    await flushPromises();
    expect(vm.editorData.value).toBe(before);
    expect(mocks.feedback.error).not.toHaveBeenCalled();
  });
});
