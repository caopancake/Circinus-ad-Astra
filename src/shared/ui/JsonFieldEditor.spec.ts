import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import JsonFieldEditor from './JsonFieldEditor.vue';
import type { RowData } from '@/shared/types';
import { editorUiStubs } from '@/test/ui-stubs';
import { h } from 'vue';
import { vi } from 'vitest';
import { NInputNumber } from 'naive-ui/es/input-number';
import { useEditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';

function mountEditor(props: { knownKeys: string[]; modelValue: RowData }) {
  return mount(JsonFieldEditor, { props, global: { stubs: editorUiStubs } });
}

describe('JsonFieldEditor', () => {
  it('registers extra numeric raw input, focuses invalid save and removes a cleared key', async () => {
    let session!: ReturnType<typeof useEditTargetDraftSession<RowData, string, null>>;
    const save = vi.fn(async (target: string, value: RowData) => ({ target, value, baseVersions: [], meta: null }));
    const wrapper = mount(
      {
        setup() {
          session = useEditTargetDraftSession<RowData, string, null>({
            emptyValue: {},
            targetKey: (target) => target,
            load: (target) => ({ target, value: { _count: 4 }, baseVersions: [], meta: null }),
            save,
          });
          return () => h(JsonFieldEditor, { knownKeys: [], modelValue: session.draftValue.value, 'onUpdate:modelValue': session.setDraft });
        },
      },
      {
        global: {
          components: { 'n-input-number': NInputNumber },
          stubs: { 'n-input': editorUiStubs['n-input']!, 'n-button': editorUiStubs['n-button']! },
        },
        attachTo: document.body,
      },
    );
    await session.loadTarget('one');
    await flushPromises();
    const input = wrapper.get('.json-field-row input');
    await input.setValue('1e');
    await expect(session.saveDraft()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    expect(session.draftValue.value._count).toBe(4);
    expect(document.activeElement).toBe(input.element);
    expect((input.element as HTMLInputElement).value).toBe('1e');
    await input.setValue('');
    await session.saveDraft();
    expect(save).toHaveBeenCalledWith('one', {}, []);
    expect(session.inputs.dirty.value).toBe(false);
    wrapper.unmount();
  });
  it('lists all extra business keys including underscore-prefixed names', () => {
    const editor = mountEditor({ knownKeys: ['id', 'name'], modelValue: { id: 'a', extra1: 'x', extra2: 3, __internal: true } });
    const keys = editor.findAll('.json-field-key').map((node) => node.text());
    expect(keys).toEqual(['extra1', 'extra2', '__internal']);
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

  it('keeps incomplete JSON in the input and commits a completed object', async () => {
    const editor = mountEditor({ knownKeys: [], modelValue: { nested: { a: 1 } } });
    const nestedInput = editor.get('.json-field-row textarea');
    await nestedInput.setValue('{broken');
    expect(editor.emitted('update:modelValue')).toBeUndefined();
    expect((nestedInput.element as HTMLTextAreaElement).value).toBe('{broken');
    await nestedInput.setValue('{"a":2}');
    await nestedInput.trigger('change');
    expect(editor.emitted('update:modelValue')?.at(-1)).toEqual([{ nested: { a: 2 } }]);
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
