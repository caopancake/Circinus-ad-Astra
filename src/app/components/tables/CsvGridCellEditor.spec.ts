import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeSettingsStore } from '@/stores/settings.store';
import type { CsvSourceIndex } from '@/domain/tables/csv-source-options';
import type { CsvGridColumn } from '@/domain/tables/csv-grid-model';
import CsvGridCellEditor from './CsvGridCellEditor.vue';
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

const sourceIndex: CsvSourceIndex = { optionsBySource: new Map(), valueIndexBySource: new Map(), valueSetsBySource: new Map() };

function columnFixture(control: string): CsvGridColumn {
  return {
    className: `schema-col-${control}`,
    enumOptions: [],
    key: 'size',
    schema: control === 'text' ? null : ({ key: 'size', control } as CsvGridColumn['schema']),
    widthPx: 100,
  };
}

let wrapper: import('@vue/test-utils').VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function mountEditor(props: Record<string, unknown>) {
  wrapper = mount(CsvGridCellEditor, {
    props: {
      anchorElement: null,
      row: { rowKey: 'key-0', row: { size: 'MEDIUM' } },
      sourceIndex,
      ...props,
    } as never,
    global: {
      stubs: {
        ...editorUiStubs,
        CsvCellPicker: {
          name: 'CsvCellPicker',
          props: ['anchor', 'multiple', 'options', 'values'],
          emits: ['close', 'update'],
          template: '<div class="picker-stub" />',
        },
        CsvCellTextEditor: {
          name: 'CsvCellTextEditor',
          props: ['anchor', 'value'],
          emits: ['close', 'commit'],
          template: '<div class="text-editor-stub" />',
        },
      },
    },
    attachTo: document.body,
  });
  return wrapper!;
}

describe('CsvGridCellEditor', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore({ ...SETTINGS });
  });

  it('commits edited native input on blur and on enter', async () => {
    const editor = mountEditor({ column: columnFixture('number') });
    const input = editor.get('input');
    await input.setValue('LARGE');
    await input.trigger('blur');
    expect(editor.emitted('update-cell')?.[0]).toEqual(['key-0', 'size', 'LARGE']);
    expect(editor.emitted('close')).toHaveLength(1);

    const editor2 = mountEditor({ column: columnFixture('number') });
    const input2 = editor2.get('input');
    await input2.setValue('SMALL');
    await input2.trigger('keydown', { key: 'Enter' });
    expect(editor2.emitted('update-cell')?.[0]).toEqual(['key-0', 'size', 'SMALL']);
  });

  it('does not emit when the native value is unchanged', async () => {
    const editor = mountEditor({ column: columnFixture('number') });
    await editor.get('input').setValue('MEDIUM');
    await editor.get('input').trigger('blur');
    expect(editor.emitted('update-cell')).toBeUndefined();
    expect(editor.emitted('close')).toHaveLength(1);
  });

  it('commits plain edit mode through the native input for picker controls', async () => {
    const { useSettingsStore } = await import('@/stores/settings.store');
    useSettingsStore().setEditMode('plain');
    const editor = mountEditor({ column: columnFixture('enum') });
    const input = editor.get('input');
    await input.setValue('changed');
    await input.trigger('blur');
    expect(editor.emitted('update-cell')?.[0]).toEqual(['key-0', 'size', 'changed']);
  });

  it('shows the raw value for text controls in smart mode until anchored', () => {
    const editor = mountEditor({ column: columnFixture('text') });
    expect(editor.find('.csv-cell-value').text()).toBe('MEDIUM');
    expect(editor.find('input').exists()).toBe(false);
  });

  it('applies picker updates and formats list values once anchored', async () => {
    const editor = mountEditor({ column: columnFixture('enum'), anchorElement: document.createElement('div') });
    await editor.vm.$nextTick();
    await editor.vm.$nextTick();
    const picker = editor.findComponent({ name: 'CsvCellPicker' });
    expect(picker.exists()).toBe(true);
    picker.vm.$emit('update', ['LARGE']);
    await editor.vm.$nextTick();
    expect(editor.emitted('update-cell')?.[0]).toEqual(['key-0', 'size', 'LARGE']);
  });

  it('commits through the text editor once anchored', async () => {
    const editor = mountEditor({ column: columnFixture('text'), anchorElement: document.createElement('div') });
    await editor.vm.$nextTick();
    await editor.vm.$nextTick();
    const textEditor = editor.findComponent({ name: 'CsvCellTextEditor' });
    expect(textEditor.exists()).toBe(true);
    textEditor.vm.$emit('commit', 'committed');
    await editor.vm.$nextTick();
    expect(editor.emitted('update-cell')?.[0]).toEqual(['key-0', 'size', 'committed']);
  });

  it('closes on the escape key', async () => {
    const editor = mountEditor({ column: columnFixture('number') });
    await editor.get('.csv-cell-editor').trigger('keydown', { key: 'Escape' });
    expect(editor.emitted('close')).toHaveLength(1);
  });
});
