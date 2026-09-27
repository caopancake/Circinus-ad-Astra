import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import JsonFieldEditor from './JsonFieldEditor.vue';
import type { RowData } from '@/shared/types';
import { editorUiStubs } from '@/test/ui-stubs';

function mountEditor(props: { knownKeys: string[]; modelValue: RowData }) {
  return mount(JsonFieldEditor, { props, global: { stubs: editorUiStubs } });
}

describe('JsonFieldEditor', () => {
  it('lists only extra keys outside the known and internal keys', () => {
    const editor = mountEditor({ knownKeys: ['id', 'name'], modelValue: { id: 'a', extra1: 'x', extra2: 3, __internal: true } });
    const keys = editor.findAll('.json-field-key').map((node) => node.text());
    expect(keys).toEqual(['extra1', 'extra2']);
  });

  it('shows the empty hint when no extra keys exist', () => {
    const editor = mountEditor({ knownKeys: ['id'], modelValue: { id: 'a' } });
    expect(editor.get('.json-field-empty').text()).toBe('无额外字段');
  });

  it('updates string and number fields through the matching controls', async () => {
    const editor = mountEditor({ knownKeys: [], modelValue: { text: 'a', count: 3 } });
    const inputs = editor.findAll('input');
    await inputs[0]!.setValue('b');
    expect(editor.emitted('update:modelValue')?.[0]).toEqual([{ text: 'b', count: 3 }]);
    await editor.findAll('input')[0]!.setValue('7');
    expect(editor.emitted('update:modelValue')?.at(-1)).toEqual([{ text: '7', count: 3 }]);
  });

  it('keeps invalid JSON as raw text for object fields', async () => {
    const editor = mountEditor({ knownKeys: [], modelValue: { nested: { a: 1 } } });
    const nestedInput = editor.get('.json-field-row textarea');
    await nestedInput.setValue('{broken');
    expect(editor.emitted('update:modelValue')?.at(-1)).toEqual([{ nested: '{broken' }]);
  });

  it('removes fields and adds new blank ones', async () => {
    const editor = mountEditor({ knownKeys: [], modelValue: { keep: 1, drop: 2 } });
    await editor.findAll('.compact-icon-button')[1]!.trigger('click');
    expect(editor.emitted('update:modelValue')?.at(-1)).toEqual([{ keep: 1 }]);

    const keyInput = editor.get('input.json-field-new-key');
    await keyInput.setValue('added');
    await editor.findAll('.json-field-add button').at(-1)!.trigger('click');
    expect(editor.emitted('update:modelValue')?.at(-1)).toEqual([{ keep: 1, added: '' }]);
  });
});
