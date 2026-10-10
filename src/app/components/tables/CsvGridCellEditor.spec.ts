import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initializeSettingsStore } from '@/stores/settings.store';
import type { CsvSourceIndex } from '@/domain/tables/csv-source-options';
import type { CsvGridColumn } from '@/domain/tables/csv-grid-model';
import CsvGridCellEditor from './CsvGridCellEditor.vue';
import { editorUiStubs } from '@/test/ui-stubs';
import { mountCsvInputHost } from '@/test/csv-input-host';
import { vi } from 'vitest';

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ choose: vi.fn(), error: vi.fn() }) }));

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

const media = vi.hoisted(() => ({ replace: vi.fn(async () => {}), sprite: vi.fn(() => undefined) }));
vi.mock('@/app/composables/tables/use-schema-select-media', () => ({
  useSchemaSelectMedia: () => ({ schemaSelectSprite: media.sprite, replaceSchemaSelectSprites: media.replace }),
}));

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
let fixture: ReturnType<typeof mountCsvInputHost>;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function mountEditor(props: Record<string, unknown>) {
  fixture = mountCsvInputHost(
    CsvGridCellEditor,
    {
      global: { stubs: editorUiStubs },
      attachTo: document.body,
    },
    {
      anchorElement: null,
      row: { rowKey: 'key-0', isComment: false, data: { size: 'MEDIUM' } },
      sourceIndex,
      ...props,
    },
  );
  wrapper = fixture.host;
  return fixture.surface;
}

describe('CsvGridCellEditor', () => {
  beforeEach(() => {
    media.replace.mockClear();
    setActivePinia(createPinia());
    initializeSettingsStore({ ...SETTINGS });
  });

  it('registers the selected image with the active reference control', () => {
    const resource = {
      source: 'mod' as const,
      relPath: 'graphics/selected.png',
      ownerKind: 'ship' as const,
      ownerId: 'MEDIUM',
      key: 'sprite',
    };
    const option = { label: 'Selected', value: 'MEDIUM', resourceRef: resource };
    const editor = mountEditor({
      column: { ...columnFixture('reference'), schema: { key: 'size', control: 'reference', source: 'csv:ships.id' } },
      sourceIndex: {
        optionsBySource: new Map([['csv:ships.id', [option]]]),
        valueSetsBySource: new Map([['csv:ships.id', new Set(['MEDIUM'])]]),
        valueIndexBySource: new Map([['csv:ships.id', new Map([['MEDIUM', { group: '', option }]])]]),
      },
    });
    expect(editor.text()).toContain('Selected');
    expect(media.replace).toHaveBeenCalledWith('sess-1', 'selected', [resource]);
  });

  it('commits edited native input on blur and on enter', async () => {
    const editor = mountEditor({ column: columnFixture('number') });
    const input = editor.get('input');
    await input.setValue('LARGE');
    await input.trigger('blur');
    expect(fixture.updates[0]).toEqual({ target: { ...fixture.target, rowKey: 'key-0', column: 'size' }, value: 'LARGE' });
    expect(editor.emitted('close')).toHaveLength(1);

    const editor2 = mountEditor({ column: columnFixture('number') });
    const input2 = editor2.get('input');
    await input2.setValue('SMALL');
    await input2.trigger('keydown', { key: 'Enter' });
    expect(fixture.updates[0]?.value).toBe('SMALL');
  });

  it('does not emit when the native value is unchanged', async () => {
    const editor = mountEditor({ column: columnFixture('number') });
    await editor.get('input').setValue('MEDIUM');
    await editor.get('input').trigger('blur');
    expect(fixture.updates).toEqual([]);
    expect(editor.emitted('close')).toHaveLength(1);
  });

  it('commits plain edit mode through the native input for picker controls', async () => {
    const { useSettingsStore } = await import('@/stores/settings.store');
    useSettingsStore().setEditMode('plain');
    const editor = mountEditor({ column: columnFixture('enum') });
    const input = editor.get('input');
    await input.setValue('changed');
    await input.trigger('blur');
    expect(fixture.updates[0]?.value).toBe('changed');
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
    picker.vm.$emit('commit', ['LARGE']);
    await editor.vm.$nextTick();
    expect(fixture.updates[0]?.value).toBe('LARGE');
  });

  it('commits through the text editor once anchored', async () => {
    const editor = mountEditor({ column: columnFixture('text'), anchorElement: document.createElement('div') });
    await editor.vm.$nextTick();
    await editor.vm.$nextTick();
    const textEditor = editor.findComponent({ name: 'CsvCellTextEditor' });
    expect(textEditor.exists()).toBe(true);
    await textEditor.get('textarea').setValue('committed');
    textEditor.vm.$emit('commit', 'committed');
    await editor.vm.$nextTick();
    expect(fixture.updates[0]?.value).toBe('committed');
  });

  it('closes on the escape key', async () => {
    const editor = mountEditor({ column: columnFixture('number') });
    await editor.get('.csv-cell-editor').trigger('keydown', { key: 'Escape' });
    expect(editor.emitted('close')).toHaveLength(1);
  });

  it('registers native raw input and commits its complete target without blur', async () => {
    const editor = mountEditor({ column: columnFixture('number') });
    await editor.get('input').setValue('001.50');
    expect(fixture.inputs.dirty.value).toBe(true);
    expect(fixture.updates).toEqual([]);
    await fixture.inputs.commit();
    expect(fixture.updates).toEqual([{ target: { ...fixture.target, rowKey: 'key-0', column: 'size' }, value: '001.50' }]);
    expect(fixture.inputs.dirty.value).toBe(false);
    await editor.get('input').setValue('later');
    await editor.get('input').trigger('keydown', { key: 'Escape' });
    await fixture.inputs.commit();
    expect(fixture.updates).toHaveLength(1);
  });

  it('commits an open text overlay through the same input registry', async () => {
    const editor = mountEditor({ column: columnFixture('text'), anchorElement: document.createElement('div') });
    await editor.vm.$nextTick();
    await editor.vm.$nextTick();
    await editor.get('textarea').setValue('first\nsecond');
    expect(fixture.inputs.dirty.value).toBe(true);
    await fixture.inputs.commit();
    expect(fixture.updates[0]?.value).toBe('first\nsecond');
    expect(fixture.inputs.dirty.value).toBe(false);
    wrapper!.unmount();
    wrapper = null;
    expect(fixture.inputs.commit()).toBeUndefined();
  });

  it('commits multiple selections once and cancels the next editing action', async () => {
    const editor = mountEditor({
      column: { ...columnFixture('multi'), schema: { key: 'size', control: 'multi', options: [] } },
      anchorElement: document.createElement('div'),
    });
    await editor.vm.$nextTick();
    await editor.vm.$nextTick();
    const picker = editor.findComponent({ name: 'CsvCellPicker' });
    picker.vm.$emit('update', ['A']);
    await editor.vm.$nextTick();
    picker.vm.$emit('update', ['A', 'B']);
    await editor.vm.$nextTick();
    expect(fixture.updates).toEqual([]);
    await fixture.inputs.commit();
    expect(fixture.updates).toHaveLength(1);
    expect(fixture.updates[0]?.value).toBe('A, B');
  });

  it('keeps pending input attached to the saved rowKey mapping', async () => {
    const editor = mountEditor({ column: columnFixture('number') });
    await editor.get('input').setValue('later');
    fixture.props.value = {
      ...fixture.props.value,
      row: { rowKey: 'ships:row:9', isComment: false, sourceRowIndex: 9, data: { size: 'MEDIUM' } },
    };
    await editor.vm.$nextTick();
    await fixture.inputs.commit();
    expect(fixture.updates[0]).toEqual({ target: { ...fixture.target, rowKey: 'ships:row:9', column: 'size' }, value: 'later' });
  });
});
