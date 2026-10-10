import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { entityTargetFixture } from '@/test/entity-target';
import { savedWriteFixture } from '@/test/write-result';
import { csvDraftRow } from '@/test/csv-row';
import { TABLE_KEYS, type AppFeedback, type ProjectManifest, type EntityEditInfo } from '@/shared/types';
import { WINDOW_EVENTS, type EntityTablePrepareEvent } from '@/windows/window.events';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown) => Promise<void> | void>(),
  sent: [] as Array<{ name: string; payload: unknown }>,
  save: vi.fn(),
  query: vi.fn(),
  reserve: vi.fn(async () => {}),
  release: vi.fn(async () => {}),
  retarget: vi.fn(async () => {}),
}));
vi.mock('@/windows/current.window', () => ({ currentWindowLabel: () => 'managed-1' }));
vi.mock('@/windows/tauri.events', () => ({
  listenWindowEvent: async (name: string, handler: (event: unknown) => void | Promise<void>) => {
    mocks.handlers.set(name, handler);
    return () => mocks.handlers.delete(name);
  },
  emitWindowEvent: async (name: string, payload: unknown) => {
    mocks.sent.push({ name, payload });
    await mocks.handlers.get(name)?.(payload);
  },
}));
vi.mock('@/orchestrators/table-save.orchestrator', () => ({ saveTableChanges: mocks.save }));
vi.mock('@/orchestrators/project-session-refresh.orchestrator', () => ({ applyCommittedWriteCacheInvalid: vi.fn() }));
vi.mock('@/services/editor.service', () => ({ queryEditorEditInfo: mocks.query, queryEditorIdentityIntent: vi.fn() }));
vi.mock('@/services/window.service', () => ({
  reserveNativeWindowTargets: mocks.reserve,
  releaseNativeWindowTargets: mocks.release,
  retargetNativeWindow: mocks.retarget,
}));

import { createEntitySavePreparation, listenEntityTablePreparation } from './entity-identity.orchestrator';
import { useTablesStore } from '@/stores/tables.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

const source = {
  ...entityTargetFixture('ship', 'old'),
  linkedRecord: { kind: 'csv' as const, table: 'ships' as const, rowKey: 'ships:row:0' },
};
const root = 'M:/mod';
const manifest: ProjectManifest = {
  baseVersions: [],
  sessionId: 's1',
  modRoot: root,
  starsectorRoot: null,
  coreAvailable: false,
  associatedSpecTables: [],
  modInfo: null,
  warnings: [],
  entitySummaries: { ships: 1, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0, factions: 0, missions: 0 },
  tableSummaries: Object.fromEntries(
    TABLE_KEYS.map((table) => [table, { path: `${table}.csv`, header: ['id'], available: true, totalRows: 1 }]),
  ) as ProjectManifest['tableSummaries'],
  tableEntitySummaries: Object.fromEntries(TABLE_KEYS.map((table) => [table, 0])) as ProjectManifest['tableEntitySummaries'],
};
const feedback = { error: vi.fn(), choose: vi.fn() } as unknown as AppFeedback;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.sent.length = 0;
  useWorkspaceStore().registerMod({ modRoot: root, displayName: 'Mod', version: '', status: 'ready' });
  useWorkspaceStore().activateModTable(root);
  useProjectStore().registerProjectManifest(manifest);
  const tables = useTablesStore();
  tables.initializeModTables({ sessionId: manifest.sessionId, modRoot: root, manifest });
  const state = tables.getModTableState(root)!;
  state.tables.ships = [csvDraftRow({ id: 'old' }, 'ships:row:0', 0)];
  state.originalTables.ships = [csvDraftRow({ id: 'old' }, 'ships:row:0', 0)];
  mocks.save.mockResolvedValue({ status: 'noop' });
  mocks.query.mockResolvedValue({
    target: source,
    baseVersions: [{ path: root + '/ships.csv', fingerprint: 'v1' }],
  } satisfies EntityEditInfo);
});

describe('entity table preparation', () => {
  it('saves the declared table, holds its lock and accepts the identity receipt before release', async () => {
    const stop = await listenEntityTablePreparation(feedback, async () => []);
    const client = await createEntitySavePreparation();
    const receipt = savedWriteFixture();
    receipt.identityChanges = [{ before: source, after: { ...source, id: 'new' } }];
    receipt.baseVersions = [{ path: root + '/ships.csv', fingerprint: 'v2' }];
    await client.withPreparation('s1', root, source, async (info) => {
      expect(info?.target.id).toBe('old');
      expect(useTablesStore().currentTableLocked).toBe(true);
      useTablesStore().updateCellValue({ sessionId: 's1', modRoot: root, table: 'ships', rowKey: 'ships:row:0', column: 'id' }, 'blocked');
      expect(useTablesStore().getModTableState(root)!.tables.ships[0]?.data.id).toBe('old');
      await client.finish(receipt);
      expect(useTablesStore().currentTableLocked).toBe(false);
      expect(useTablesStore().getModTableState(root)!.originalTables.ships[0]?.data.id).toBe('new');
      return 'accepted';
    });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ table: 'ships', manifest }));
    expect(mocks.release).toHaveBeenCalled();
    client.dispose();
    stop();
  });

  it.each(['cancelled', 'failed'])('ends a %s preparation without submitting the spec', async (status) => {
    if (status === 'cancelled') mocks.save.mockResolvedValue({ status });
    else mocks.save.mockRejectedValue(new Error('CSV failed'));
    const stop = await listenEntityTablePreparation(feedback, async () => []);
    const client = await createEntitySavePreparation();
    const submit = vi.fn(async () => 'saved');
    const saving = client.withPreparation('s1', root, source, submit);
    if (status === 'cancelled') await expect(saving).resolves.toBeNull();
    else await expect(saving).rejects.toMatchObject({ action: 'prepare-entity-table' });
    expect(submit).not.toHaveBeenCalled();
    expect(useTablesStore().currentTableLocked).toBe(false);
    client.dispose();
    stop();
  });

  it('matches replies by request, owner and full source and releases after consumer disposal', async () => {
    const client = await createEntitySavePreparation();
    const submit = vi.fn(async () => 'saved');
    const pending = client.withPreparation('s1', root, source, submit);
    await Promise.resolve();
    const request = mocks.sent.find((event) => event.name === WINDOW_EVENTS.entityTablePrepare)!.payload as EntityTablePrepareEvent;
    await mocks.handlers.get(WINDOW_EVENTS.entityTablePrepared)!({
      ...request,
      ownerLabel: 'other',
      status: 'ready',
      info: { target: source, baseVersions: [] },
    });
    expect(submit).not.toHaveBeenCalled();
    client.dispose();
    await expect(pending).resolves.toBeNull();
    expect(mocks.release).toHaveBeenCalled();
  });
});
