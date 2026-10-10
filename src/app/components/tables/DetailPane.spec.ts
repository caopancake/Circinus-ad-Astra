import { mount } from '@vue/test-utils';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSettingsStore } from '@/stores/settings.store';
import { useProjectStore } from '@/stores/project.store';
import { useTablesStore } from '@/stores/tables.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { TABLE_KEYS } from '@/shared/types';
import type { CsvTableWindow, ProjectManifest } from '@/shared/types';
import DetailPane from './DetailPane.vue';

function tableSummariesFixture(): ProjectManifest['tableSummaries'] {
  const summaries = {} as ProjectManifest['tableSummaries'];
  for (const key of TABLE_KEYS) {
    summaries[key] = { path: '', header: [], available: false, totalRows: 0 };
  }
  return summaries;
}

function tableEntitySummariesFixture(): ProjectManifest['tableEntitySummaries'] {
  const summaries = {} as ProjectManifest['tableEntitySummaries'];
  for (const key of TABLE_KEYS) summaries[key] = 0;
  return summaries;
}

const SETTINGS = {
  theme: 'light',
  accent: 'blue',
  customAccent: '#3388cc',
  historyLimit: 20,
  editMode: 'smart',
  starsectorRoot: null,
  logDirectory: null,
  logLevel: 'info',
} as const;

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => ({
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  }),
}));

vi.mock('@/app/composables/tables/use-schema-select-media', () => ({
  useSchemaSelectMedia: () => ({
    schemaSelectSprite: vi.fn(() => 'data:image/png;base64,thumb'),
    replaceSchemaSelectSprites: vi.fn(async () => {}),
    releaseSchemaSelectSprites: vi.fn(),
  }),
}));

let wrapper: import('@vue/test-utils').VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function manifestFixture(modRoot: string): ProjectManifest {
  return {
    baseVersions: [],
    sessionId: 'sess-1',
    modRoot,
    starsectorRoot: null,
    coreAvailable: false,
    associatedSpecTables: ['ships'],
    modInfo: { name: 'Alpha' },
    tableSummaries: tableSummariesFixture(),
    tableEntitySummaries: tableEntitySummariesFixture(),
    entitySummaries: { factions: 0, missions: 0, ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0 },
    warnings: [],
  };
}

function activateProject() {
  const workspace = useWorkspaceStore();
  const project = useProjectStore();
  const tables = useTablesStore();
  workspace.registerMod({ modRoot: 'M:/mod', displayName: 'Alpha', version: '', status: 'ready' });
  project.registerProjectManifest(manifestFixture('M:/mod'));
  // Hydrate the per-Mod table state the same way the directory-opening runtime does.
  tables.initializeModTables({ sessionId: manifestFixture('M:/mod').sessionId, modRoot: 'M:/mod', manifest: manifestFixture('M:/mod') });
  workspace.activateModTab('M:/mod');
  return { workspace, project, tables };
}

function mountPane() {
  wrapper = mount(DetailPane, {
    props: {
      queryRowPreview: vi.fn(async () => ''),
      sourceIndex: { optionsBySource: new Map(), valueIndexBySource: new Map(), valueSetsBySource: new Map() },
    },
    global: { plugins: [getActivePinia()!] },
  });
  return wrapper!;
}

describe('DetailPane', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore({ ...SETTINGS });
  });

  it('renders the display id and module label of the selected row', async () => {
    activateProject();
    const tables = useTablesStore();
    const manifest = useProjectStore().getManifest('M:/mod')!;
    // Seed one ship row through the table state store.
    const window = {
      baseVersions: [],
      table: 'ships',
      start: 0,
      header: ['id', 'name'],
      totalRows: 1,
      filteredRows: 1,
      rows: [{ rowKey: 'key-XY', isComment: false, sourceRowIndex: 0, factionId: null, data: { id: 'XY', name: 'Ruler' } }],
    } satisfies CsvTableWindow;
    tables.applyTableWindow({ sessionId: 'sess-1', modRoot: 'M:/mod', table: 'ships' }, window);
    tables.selectRowByKey({ sessionId: 'sess-1', modRoot: 'M:/mod', table: 'ships' }, 'key-XY');
    void manifest;

    const pane = mountPane();
    expect(pane.html()).toContain('XY');
  });

  it('handles an empty selection without crashing', () => {
    activateProject();
    const pane = mountPane();
    expect(pane.exists()).toBe(true);
  });

  it('exposes the editor actions for a registered spec table', async () => {
    activateProject();
    const tables = useTablesStore();
    const window = {
      baseVersions: [],
      table: 'ships',
      start: 0,
      header: ['id'],
      totalRows: 1,
      filteredRows: 1,
      rows: [{ rowKey: 'key-XY', isComment: false, sourceRowIndex: 0, factionId: null, data: { id: 'XY', name: '#quoted' } }],
    } satisfies CsvTableWindow;
    tables.applyTableWindow({ sessionId: 'sess-1', modRoot: 'M:/mod', table: 'ships' }, window);
    tables.selectRowByKey({ sessionId: 'sess-1', modRoot: 'M:/mod', table: 'ships' }, 'key-XY');

    const pane = mountPane();
    const html = pane.html();
    // The ships table carries a ship spec editor entry point.
    expect(html).toContain('舰船编辑器');
  });

  it('marks comment rows in the detail header', async () => {
    activateProject();
    const tables = useTablesStore();
    const window = {
      baseVersions: [],
      table: 'ships',
      start: 0,
      header: ['id'],
      totalRows: 1,
      filteredRows: 1,
      rows: [{ rowKey: 'key-c', isComment: true, sourceRowIndex: 0, factionId: null, data: { id: '#note' } }],
    } satisfies CsvTableWindow;
    tables.applyTableWindow({ sessionId: 'sess-1', modRoot: 'M:/mod', table: 'ships' }, window);
    tables.selectRowByKey({ sessionId: 'sess-1', modRoot: 'M:/mod', table: 'ships' }, 'key-c');

    const pane = mountPane();
    expect(pane.html()).toContain('#note');
    expect(pane.html()).toContain('注释行只允许编辑 CSV 内容');
    expect(pane.html()).not.toContain('舰船编辑器');
  });
});
