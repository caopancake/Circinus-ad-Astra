import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import JsonFieldEditor from './JsonFieldEditor.vue';
import { useEditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { editorUiStubs } from '@/test/ui-stubs';
import type { RowData } from '@/shared/types';
import JsonValueInput from './JsonValueInput.vue';

describe('JSON field save boundary', () => {
  it('validates the declared shape and preserves unrelated raw buffers', async () => {
    const save = vi.fn(async (_target: string, value: RowData) => ({ target: 'one', baseVersions: [], meta: null, value }));
    let session!: ReturnType<typeof useEditTargetDraftSession<RowData, string>>;
    const wrapper = mount(
      {
        setup() {
          session = useEditTargetDraftSession<RowData, string>({
            emptyValue: {},
            load: () => ({ target: 'one', baseVersions: [], meta: null, value: { first: {}, second: {}, third: [] } }),
            save,
            targetKey: (key) => key,
          });
          return () => h(JsonFieldEditor, { modelValue: session.draftValue.value, knownKeys: [], 'onUpdate:modelValue': session.setDraft });
        },
      },
      { global: { stubs: editorUiStubs }, attachTo: document.body },
    );
    await session.loadTarget('one');
    const inputs = wrapper.findAll('textarea');
    const enterRaw = async (index: number, raw: string) => {
      (inputs[index]!.element as HTMLTextAreaElement).value = raw;
      await inputs[index]!.trigger('input');
    };
    await enterRaw(0, '{"x":2}');
    await enterRaw(1, '[]');
    await enterRaw(2, '[3]');
    await expect(session.saveDraft()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    expect(session.draftValue.value).toEqual({ first: { x: 2 }, second: {}, third: [] });
    expect(document.activeElement).toBe(inputs[1]!.element);
    expect((inputs[2]!.element as HTMLTextAreaElement).value).toBe('[3]');
    await enterRaw(1, '{"y":4}');
    await session.saveDraft();
    expect(save).toHaveBeenCalledWith('one', { first: { x: 2 }, second: { y: 4 }, third: [3] }, []);
    wrapper.unmount();
  });

  it('normalizes a validated object at its domain boundary', async () => {
    const normalized = vi.fn((value: RowData) => ({ ...value, normalized: true }));
    const wrapper = mount(JsonValueInput<'object'>, {
      props: { value: {}, shape: 'object', label: '规格', normalize: normalized },
      global: { stubs: editorUiStubs },
    });
    await wrapper.get('textarea').setValue('{"x":2}');
    expect(wrapper.emitted('update')?.at(-1)).toEqual([{ x: 2, normalized: true }]);
    wrapper.unmount();
  });
  it('commits multiple pending objects into the same save snapshot', async () => {
    const save = vi.fn(async (_target: string, value: RowData) => ({ target: 'one', baseVersions: [], meta: null, value }));
    let session!: ReturnType<typeof useEditTargetDraftSession<RowData, string>>;
    const wrapper = mount(
      {
        setup() {
          session = useEditTargetDraftSession<RowData, string>({
            emptyValue: {},
            load: () => ({ target: 'one', baseVersions: [], meta: null, value: { first: { x: 1 }, second: { y: 1 } } }),
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
    const save = vi.fn(async (_target: string, value: RowData) => ({ target: 'one', baseVersions: [], meta: null, value }));
    let session!: ReturnType<typeof useEditTargetDraftSession<RowData, string>>;
    const wrapper = mount(
      {
        setup() {
          session = useEditTargetDraftSession<RowData, string>({
            emptyValue: {},
            load: () => ({ target: 'one', baseVersions: [], meta: null, value: { nested: { x: 1 } } }),
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
    session.applyExternalForTarget({
      target: 'one',
      value: { nested: { x: 9 } },
      baseVersions: [{ path: 'one', fingerprint: 'new' }],
      meta: null,
    });
    expect(session.hasPendingExternalValue.value).toBe(true);
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('{"x":');
    await wrapper.get('textarea').setValue('{"x":2}');
    await session.saveDraft();
    expect(save).toHaveBeenCalledWith('one', { nested: { x: 2 } }, []);
    expect(session.dirty.value).toBe(false);
    wrapper.unmount();
  });
});
