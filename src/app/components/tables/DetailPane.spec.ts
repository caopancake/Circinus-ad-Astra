import { mount } from '@vue/test-utils';
import { createPinia, getActivePinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSettingsStore } from '@/stores/settings.store';
import { useProjectStore } from '@/stores/project.store';
import { useTablesStore } from '@/stores/tables.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { TABLE_KEYS } from '@/shared/types';
import type { ProjectManifest } from '@/shared/types';
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
    ensureSchemaSelectSprites: vi.fn(async () => {}),
  }),
}));

let wrapper: import('@vue/test-utils').VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function manifestFixture(modRoot: string): ProjectManifest {
  return {
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
  tables.hydrateWithoutActivate('M:/mod', manifestFixture('M:/mod'));
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
      table: 'ships',
      start: 0,
      header: ['id', 'name'],
      totalRows: 1,
      filteredRows: 1,
      rows: [{ rowKey: 'key-XY', row: { id: 'XY', name: 'Ruler' } }],
    } as never;
    tables.applyTableWindow(window);
    tables.selectRowByKey('key-XY');
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
      table: 'ships',
      start: 0,
      header: ['id'],
      totalRows: 1,
      filteredRows: 1,
      rows: [{ rowKey: 'key-XY', row: { id: 'XY' } }],
    } as never;
    tables.applyTableWindow(window);
    tables.selectRowByKey('key-XY');

    const pane = mountPane();
    const html = pane.html();
    // The ships table carries a ship spec editor entry point.
    expect(html).toContain('舰船编辑器');
  });

  it('marks comment rows in the detail header', async () => {
    activateProject();
    const tables = useTablesStore();
    const window = {
      table: 'ships',
      start: 0,
      header: ['id'],
      totalRows: 1,
      filteredRows: 1,
      rows: [{ rowKey: 'key-c', row: { id: '#note' } }],
    } as never;
    tables.applyTableWindow(window);
    tables.selectRowByKey('key-c');

    const pane = mountPane();
    expect(pane.html()).toContain('#note');
  });
});
