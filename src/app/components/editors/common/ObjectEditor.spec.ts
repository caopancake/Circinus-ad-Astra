import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import ObjectEditor from './ObjectEditor.vue';

describe('ObjectEditor', () => {
  it('renders the current model as formatted JSON', () => {
    const editor = mount(ObjectEditor, { props: { title: '内置装备', modelValue: { a: 1 } } });
    expect(editor.get('label').text()).toBe('内置装备');
    expect((editor.get('textarea').element as HTMLTextAreaElement).value).toBe('{\n  "a": 1\n}');
  });

  it('commits valid JSON back to the model on change', async () => {
    const editor = mount(ObjectEditor, { props: { modelValue: {} } });
    await editor.find('textarea').setValue('{"b":2}');
    expect(editor.emitted('update:modelValue')?.at(-1)).toEqual([{ b: 2 }]);
    expect(editor.emitted('invalid-json')).toBeUndefined();
  });

  it('keeps the raw text and reports invalid JSON instead of committing', async () => {
    const editor = mount(ObjectEditor, { props: { modelValue: {} } });
    await editor.find('textarea').setValue('{broken');
    expect(editor.emitted('invalid-json')?.length).toBeGreaterThanOrEqual(1);
    expect(editor.emitted('update:modelValue')).toBeUndefined();
    expect((editor.get('textarea').element as HTMLTextAreaElement).value).toBe('{broken');
  });

  it('uses the host parse hook when provided', async () => {
    const parse = vi.fn((text: string) => ({ parsed: text }));
    const editor = mount(ObjectEditor, { props: { modelValue: {}, parse } });
    await editor.find('textarea').setValue('raw-text');
    expect(parse).toHaveBeenCalledWith('raw-text');
    expect(editor.emitted('update:modelValue')?.[0]).toEqual([{ parsed: 'raw-text' }]);
  });

  it('refreshes the text when the model is replaced from outside', async () => {
    const editor = mount(ObjectEditor, { props: { modelValue: { a: 1 } } });
    await editor.setProps({ modelValue: { b: 2 } });
    expect((editor.get('textarea').element as HTMLTextAreaElement).value).toBe('{\n  "b": 2\n}');
  });
});
