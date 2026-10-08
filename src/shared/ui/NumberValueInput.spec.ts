import { flushPromises, mount } from '@vue/test-utils';
import { h } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NInputNumber } from 'naive-ui/es/input-number';
import NumberValueInput from './NumberValueInput.vue';
import { useEditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { applySchemaFieldUpdate } from '@/domain/schema/schema-values';
import type { RowData } from '@/shared/types';

let wrapper: ReturnType<typeof mount>;
afterEach(() => wrapper?.unmount());

async function harness(clearAction: 'remove' | 'required' = 'remove', integer = false) {
  let session!: ReturnType<typeof useEditTargetDraftSession<RowData, string, null>>;
  const save = vi.fn(async (target: string, value: RowData) => ({ target, value, baseVersions: [], meta: null }));
  wrapper = mount(
    {
      setup() {
        session = useEditTargetDraftSession<RowData, string, null>({
          emptyValue: {},
          targetKey: (target) => target,
          load: (target) => ({ target, value: { count: 4 }, baseVersions: [], meta: null }),
          save,
        });
        return () =>
          h(NumberValueInput, {
            value: session.draftValue.value.count,
            inputKey: 'count',
            label: 'Count',
            integer,
            clearAction,
            'onUpdate:value': (value) =>
              session.setDraft(applySchemaFieldUpdate(session.draftValue.value, 'count', { kind: 'set', value })),
            onRemove: () => session.setDraft(applySchemaFieldUpdate(session.draftValue.value, 'count', { kind: 'remove' })),
          });
      },
    },
    { global: { components: { 'n-input-number': NInputNumber } }, attachTo: document.body },
  );
  await session.loadTarget('one');
  await flushPromises();
  return { session, save };
}

describe('Smart numeric input with real Naive UI', () => {
  it.each(['-', '1e', '1.2.3'])('retains %s, participates in dirty and focuses the failed save', async (raw) => {
    const { session, save } = await harness();
    const input = wrapper.get('input');
    await input.setValue(raw);
    expect(session.draftValue.value.count).toBe(4);
    expect(session.dirty.value).toBe(true);
    await expect(session.saveDraft()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    expect(document.activeElement).toBe(input.element);
    expect((input.element as HTMLInputElement).value).toBe(raw);
    expect(save).not.toHaveBeenCalled();
    await input.setValue('12.5');
    await session.saveDraft();
    expect(save).toHaveBeenCalledWith('one', { count: 12.5 }, []);
    expect(session.dirty.value).toBe(false);
  });
  it('removes an optional key on save and retains required empty input', async () => {
    const { session, save } = await harness();
    await wrapper.get('input').setValue('');
    await session.saveDraft();
    expect(save).toHaveBeenCalledWith('one', {}, []);
    wrapper.unmount();
    const required = await harness('required');
    await wrapper.get('input').setValue('');
    await expect(required.session.saveDraft()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    expect(required.session.draftValue.value.count).toBe(4);
  });
  it('rejects fractional integers and restores cancelled raw input for an equal baseline', async () => {
    const { session } = await harness('required', true);
    await wrapper.get('input').setValue('1.5');
    await expect(session.saveDraft()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    session.resetDraft();
    await flushPromises();
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('4');
    expect(session.dirty.value).toBe(false);
  });
});
