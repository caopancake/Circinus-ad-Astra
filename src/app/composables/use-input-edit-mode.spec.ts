import { mount, flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, ref } from 'vue';
import { createFieldInputs, provideFieldInputs } from '@/shared/runtime/field-inputs';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { useInputEditMode } from './use-input-edit-mode';

const feedback = vi.hoisted(() => ({ choose: vi.fn(), error: vi.fn() }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => feedback }));

beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  initializeSettingsStore({
    theme: 'light',
    accent: 'blue',
    customAccent: '#3388cc',
    historyLimit: 20,
    editMode: 'plain',
    starsectorRoot: null,
    logDirectory: null,
    logLevel: 'info',
  });
});

function mountMode() {
  const target = ref('one');
  const inputs = createFieldInputs(target);
  const dirty = ref(true);
  inputs.register({
    key: 'field',
    label: 'Field',
    dirty,
    commit: () => null,
    focus: vi.fn(),
    cancel: () => {
      dirty.value = false;
    },
  });
  let mode!: ReturnType<typeof useInputEditMode>;
  const wrapper = mount({
    setup() {
      provideFieldInputs(inputs);
      mode = useInputEditMode(inputs);
      return () => null;
    },
  });
  return { target, inputs, mode, wrapper, dirty };
}

describe('input mode handoff', () => {
  it('keeps the effective mode and pending work after cancellation', async () => {
    feedback.choose.mockResolvedValue(null);
    const fixture = mountMode();
    useSettingsStore().setEditMode('smart');
    await flushPromises();
    expect(fixture.mode.value).toBe('plain');
    expect(fixture.inputs.dirty.value).toBe(true);
    fixture.wrapper.unmount();
  });

  it('discards pending input before adopting the latest mirrored setting', async () => {
    feedback.choose.mockResolvedValue('discard');
    const fixture = mountMode();
    useSettingsStore().setEditMode('smart');
    await flushPromises();
    expect(fixture.mode.value).toBe('smart');
    expect(fixture.inputs.dirty.value).toBe(false);
    fixture.wrapper.unmount();
  });

  it('keeps a late confirmation bound to its target and lifecycle', async () => {
    let resolve!: (choice: string | null) => void;
    feedback.choose.mockImplementation(
      () =>
        new Promise((accept) => {
          resolve = accept;
        }),
    );
    const fixture = mountMode();
    useSettingsStore().setEditMode('smart');
    await nextTick();
    fixture.wrapper.unmount();
    resolve('discard');
    await flushPromises();
    expect(fixture.dirty.value).toBe(true);
  });

  it('keeps post-save raw input and its mode during an identity handoff', async () => {
    feedback.choose.mockResolvedValue(null);
    const fixture = mountMode();
    useSettingsStore().setEditMode('smart');
    await flushPromises();
    fixture.target.value = 'saved-identity';
    await nextTick();
    expect(fixture.mode.value).toBe('plain');
    expect(fixture.dirty.value).toBe(true);
    fixture.wrapper.unmount();
  });
});
