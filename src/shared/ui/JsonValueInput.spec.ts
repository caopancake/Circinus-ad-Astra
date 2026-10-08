import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import JsonFieldEditor from './JsonFieldEditor.vue';
import { useEditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { editorUiStubs } from '@/test/ui-stubs';
import type { RowData } from '@/shared/types';

describe('JSON field save boundary', () => {
  it('commits multiple pending objects into the same save snapshot', async () => {
    const save = vi.fn(async (_target: string, value: RowData) => ({ value }));
    let session!: ReturnType<typeof useEditTargetDraftSession<RowData, string>>;
    const wrapper = mount(
      {
        setup() {
          session = useEditTargetDraftSession<RowData, string>({
            emptyValue: {},
            load: () => ({ value: { first: { x: 1 }, second: { y: 1 } } }),
            save,
            targetKey: (id) => id,
          });
          return () =>
            h(JsonFieldEditor, {
              modelValue: session.draftValue.value,
              knownKeys: [],
              'onUpdate:modelValue': (value) => session.setDraft(value),
            });
        },
      },
      { global: { stubs: editorUiStubs } },
    );
    await session.loadTarget('one');
    const inputs = wrapper.findAll('textarea');
    await inputs[0]!.setValue('{"x":2}');
    await inputs[1]!.setValue('{"y":3}');
    await session.saveDraft();
    expect(save).toHaveBeenCalledWith('one', { first: { x: 2 }, second: { y: 3 } }, []);
    wrapper.unmount();
  });
  it('keeps unfinished input dirty, blocks saving and commits the corrected object', async () => {
    const save = vi.fn(async (_target: string, value: RowData) => ({ value }));
    let session!: ReturnType<typeof useEditTargetDraftSession<RowData, string>>;
    const wrapper = mount(
      {
        setup() {
          session = useEditTargetDraftSession<RowData, string>({
            emptyValue: {},
            load: () => ({ value: { nested: { x: 1 } } }),
            save,
            targetKey: (id) => id,
          });
          return () =>
            h(JsonFieldEditor, {
              modelValue: session.draftValue.value,
              knownKeys: [],
              'onUpdate:modelValue': (value) => session.setDraft(value),
            });
        },
      },
      { global: { stubs: editorUiStubs }, attachTo: document.body },
    );
    await session.loadTarget('one');
    await wrapper.get('textarea').setValue('{"x":');
    expect(session.dirty.value).toBe(true);
    await expect(session.saveDraft()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    expect(save).not.toHaveBeenCalled();
    expect(session.draftValue.value.nested).toEqual({ x: 1 });
    session.applyExternalForTarget('one', { nested: { x: 9 } });
    expect(session.hasPendingExternalValue.value).toBe(true);
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('{"x":');
    await wrapper.get('textarea').setValue('{"x":2}');
    await session.saveDraft();
    expect(save).toHaveBeenCalledWith('one', { nested: { x: 2 } }, []);
    expect(session.dirty.value).toBe(false);
    wrapper.unmount();
  });
});
