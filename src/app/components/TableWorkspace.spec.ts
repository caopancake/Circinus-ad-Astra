import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TableWorkspace from './TableWorkspace.vue';
import { useTablesStore } from '@/stores/tables.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { navigateToModTable } from '@/orchestrators/workspace-navigation.orchestrator';
import { initializeSettingsStore } from '@/stores/settings.store';
import { sessionUpdateFixture } from '@/test/write-result';
import { editorUiStubs, nInput } from '@/test/ui-stubs';
import type { CsvTableWindow } from '@/shared/types';

const mocks = vi.hoisted(() => ({ query: vi.fn(), error: vi.fn() }));
vi.mock('@/services/csv-table.service', () => ({ queryTableWindow: mocks.query, queryTableRowPreviewDataUrl: async () => '' }));
vi.mock('@/services/source-options.service', () => ({ querySourceOptionCatalog: async () => [] }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));
vi.mock('@/app/composables/use-workspace-shell-actions', () => ({ useWorkspaceShellActions: () => ({}) }));

let wrapper: VueWrapper;
const target = { sessionId: 'search-session', modRoot: 'M:/search', table: 'ships' as const };
function record(header = ['id', 'name', 'tags']): CsvTableWindow {
  return {
    table: 'ships',
    header,
    start: 0,
    totalRows: 1,
    filteredRows: 1,
    baseVersions: [],
    rows: [{ rowKey: 'row', isComment: false, sourceRowIndex: 0, data: { id: 'Alpha', name: '银河', tags: 'demo_bp' } }],
  };
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  initializeSettingsStore({
    theme: 'light',
    accent: 'blue',
    customAccent: '#3388cc',
    historyLimit: 20,
    editMode: 'plain',
    starsectorRoot: null,
    logDirectory: null,
    logLevel: 'info',
  });
  const update = sessionUpdateFixture(target.sessionId, target.modRoot);
  if (update.status !== 'ready') throw new Error('fixture is ready');
  update.projection.manifest.tableSummaries.ships.header = record().header;
  useWorkspaceStore().registerMod({ modRoot: target.modRoot, displayName: 'Search', version: '', status: 'ready' });
  useProjectStore().registerProjectManifest(update.projection.manifest);
  useTablesStore().initializeModTables({ ...target, manifest: update.projection.manifest });
  navigateToModTable(target.modRoot, target.table);
  mocks.query.mockResolvedValue(record());
});
afterEach(() => wrapper?.unmount());
async function mountWorkspace() {
  wrapper = mount(TableWorkspace, { global: { stubs: { ...editorUiStubs, DataTable: true, DetailPane: true } } });
  await flushPromises();
}
describe('table workspace search controls', () => {
  it('shows the declared fields and changes the search prompt while retaining the keyword', async () => {
    await mountWorkspace();
    const select = wrapper.get('select');
    expect(select.findAll('option').map((option) => option.text())).toEqual(['ID/名称', 'ID', '名称', 'tags']);
    expect((select.element as HTMLSelectElement).value).toBe('"id-name"');
    await wrapper.get('input').setValue('Alpha');
    await flushPromises();
    for (const [field, label] of [
      ['id', 'ID'],
      ['name', '名称'],
      ['tags', 'tags'],
    ] as const) {
      await select.setValue(JSON.stringify(field));
      await flushPromises();
      expect(useTablesStore().searchField).toBe(field);
      expect(useTablesStore().searchText).toBe('Alpha');
      expect(wrapper.getComponent(nInput).props('placeholder')).toBe(`搜索 ${label}`);
      expect(mocks.query).toHaveBeenLastCalledWith(target.sessionId, 'ships', 0, 240, 'Alpha', field, expect.any(AbortSignal));
    }
  });
  it('offers options from the authoritative header as it loads', async () => {
    const tables = useTablesStore();
    tables.getModTableState(target.modRoot)!.headers.ships = [];
    mocks.query.mockResolvedValue(record(['id']));
    await mountWorkspace();
    expect(
      wrapper
        .get('select')
        .findAll('option')
        .map((option) => option.text()),
    ).toEqual(['ID/名称', 'ID']);
    expect(tables.currentHeader).toEqual(['id']);
  });
  it('binds input and search-field locking to the current editing target', async () => {
    await mountWorkspace();
    useTablesStore().lockTable(target, 'identity-handoff');
    await flushPromises();
    expect((wrapper.get('input').element as HTMLInputElement).disabled).toBe(true);
    expect((wrapper.get('select').element as HTMLSelectElement).disabled).toBe(true);
    useTablesStore().releaseTableLock('identity-handoff');
    await flushPromises();
    expect((wrapper.get('input').element as HTMLInputElement).disabled).toBe(false);
    expect((wrapper.get('select').element as HTMLSelectElement).disabled).toBe(false);
  });
});
