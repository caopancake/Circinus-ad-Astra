import { mountCsvInputHost } from '@/test/csv-input-host';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSettingsStore } from '@/stores/settings.store';
import type { CsvSourceIndex } from '@/domain/tables/csv-source-options';
import type { CsvGridColumn } from '@/domain/tables/csv-grid-model';
import type { ResourceRef } from '@/shared/types';
import CsvGridStaticCell from './CsvGridStaticCell.vue';
import { editorUiStubs } from '@/test/ui-stubs';

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

vi.mock('@/services/resource-media.service', () => ({
  resourceMediaDataUrl: vi.fn(() => 'data:image/png;base64,x'),
  ensureResourceMedia: vi.fn(async () => {}),
}));

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ choose: vi.fn(), error: vi.fn() }) }));

let wrapper: import('@vue/test-utils').VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

const spriteRef = { key: 'icon', source: 'mod', path: 'graphics/icon.png' } as unknown as ResourceRef;

function sourceIndexFixture(): CsvSourceIndex {
  const options = [{ label: 'Railgun', value: 'railgun', resourceRef: spriteRef }];
  return {
    valueSetsBySource: new Map(),
    optionsBySource: new Map([['csv:weapons.id', options]]),
    valueIndexBySource: new Map([['csv:weapons.id', new Map([['railgun', { group: 'Mod', option: options[0]! }]])]]),
  };
}

function columnFixture(control: string, source?: string): CsvGridColumn {
  const schema = control === 'text' ? null : ({ key: 'col', control, source } as CsvGridColumn['schema']);
  return { className: `schema-col-${control}`, enumOptions: [], key: 'col', schema, widthPx: 100 };
}

function mountCell(props: Record<string, unknown>) {
  const fixture = mountCsvInputHost(
    CsvGridStaticCell,
    { global: { stubs: editorUiStubs } },
    {
      row: { rowKey: 'key-0', row: { col: 'railgun' } },
      sourceIndex: sourceIndexFixture(),
      ...props,
    },
  );
  wrapper = fixture.host;
  return fixture.surface;
}

describe('CsvGridStaticCell', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore({ ...SETTINGS });
  });

  it('renders the raw value in plain edit mode', () => {
    initializeSettingsStore({ ...SETTINGS, editMode: 'plain' });
    const cell = mountCell({ column: columnFixture('text') });
    expect(cell.get('.csv-cell-value').text()).toBe('railgun');
    expect(cell.find('.csv-cell-caret').exists()).toBe(false);
  });

  it('renders list controls as tags', () => {
    const cell = mountCell({ column: columnFixture('tags'), row: { rowKey: 'k', row: { col: 'a, b' } } });
    const tags = cell.findAll('.csv-cell-tag').map((node) => node.text());
    expect(tags).toEqual(['a', 'b']);
  });

  it('renders reference cells with the option label, caret and sprite', () => {
    const cell = mountCell({ column: columnFixture('reference', 'csv:weapons.id') });
    expect(cell.get('.csv-cell-value').text()).toBe('Railgun');
    expect(cell.find('.csv-cell-caret').exists()).toBe(true);
    expect(cell.find('.csv-cell-thumb').exists()).toBe(true);
  });

  it('renders the raw value with a caret for enum controls', () => {
    const cell = mountCell({ column: columnFixture('enum'), row: { rowKey: 'k', row: { col: 'SMALL' } } });
    expect(cell.get('.csv-cell-value').text()).toBe('SMALL');
    expect(cell.find('.csv-cell-caret').exists()).toBe(true);
  });
});
