import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { h, ref } from 'vue';
import { createFieldInputs, provideFieldInputs } from '@/shared/runtime/field-inputs';
import ColorPicker from './ColorPicker.vue';
import { editorUiStubs } from '@/test/ui-stubs';

let wrapper: import('@vue/test-utils').VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function mountPicker(modelValue: number[], props: Record<string, unknown> = {}) {
  wrapper = mount(ColorPicker, {
    props: { modelValue, ...props },
    global: { stubs: editorUiStubs },
  });
  return wrapper!;
}

describe('ColorPicker', () => {
  it('renders the current value as comma text in the text input', () => {
    const picker = mountPicker([10, 20, 30, 255]);
    const input = picker.get('.color-picker-text-input');
    expect((input.element as HTMLInputElement).value).toBe('10,20,30,255');
  });

  it('commits hex text into the rgb-array output', async () => {
    const picker = mountPicker([10, 20, 30, 255]);
    const input = picker.get('.color-picker-text-input');
    await input.setValue('#ff8000');
    await input.trigger('keyup.enter');
    expect(picker.emitted('update:modelValue')?.at(-1)).toEqual([[255, 128, 0, 255]]);
  });

  it('accepts rgba() css text', async () => {
    const picker = mountPicker([0, 0, 0, 255]);
    const input = picker.get('.color-picker-text-input');
    await input.setValue('rgba(1, 2, 3, 0.5)');
    await input.trigger('keyup.enter');
    expect(picker.emitted('update:modelValue')?.at(-1)).toEqual([[1, 2, 3, 128]]);
  });

  it('accepts bracketed comma lists', async () => {
    const picker = mountPicker([0, 0, 0, 255]);
    const input = picker.get('.color-picker-text-input');
    await input.setValue('[9, 8, 7, 250]');
    await input.trigger('keyup.enter');
    expect(picker.emitted('update:modelValue')?.at(-1)).toEqual([[9, 8, 7, 250]]);
  });

  it.each(['[]', '[1,2]', '[1,2,"bad"]', '[1,2,3,4,5]'])('preserves an invalid color array %s', async (raw) => {
    const picker = mountPicker([1, 2, 3, 255]);
    await picker.get('.color-picker-text-input').setValue(raw);
    await picker.get('.color-picker-text-input').trigger('keyup.enter');
    expect(picker.emitted('update:modelValue')).toBeUndefined();
    expect((picker.get('.color-picker-text-input').element as HTMLInputElement).value).toBe(raw);
  });

  it('keeps the draft invalid without committing unknown text', async () => {
    const picker = mountPicker([1, 2, 3, 4]);
    const input = picker.get('.color-picker-text-input');
    await input.setValue('not-a-color');
    expect(picker.emitted('update:modelValue')).toBeUndefined();
    expect(picker.get('.color-picker-text-input').classes()).toContain('color-picker-text-input');
  });

  it('emits hex strings for the hex output modes', async () => {
    const picker = mountPicker([255, 128, 0, 255], { output: 'hex-rgb' });
    const input = picker.get('.color-picker-text-input');
    await input.setValue('#10ff0f');
    await input.trigger('keyup.enter');
    expect(picker.emitted('update:modelValue')?.at(-1)).toEqual(['#10ff0f']);
  });

  it('shows the label next to the preview button', () => {
    const picker = mountPicker([0, 0, 0, 255], { label: '颜色' });
    expect(picker.get('.color-picker-label').text()).toBe('颜色');
  });

  it('protects raw color text and participates in save capture', async () => {
    const inputs = createFieldInputs(ref('one'));
    const model = ref<number[]>([1, 2, 3, 255]);
    wrapper = mount(
      {
        setup() {
          provideFieldInputs(inputs);
          return () =>
            h(ColorPicker, {
              modelValue: model.value,
              label: '颜色',
              'onUpdate:modelValue': (value) => {
                model.value = value as number[];
              },
            });
        },
      },
      { global: { stubs: editorUiStubs } },
    );
    await wrapper.get('.color-picker-text-input').setValue('#ff8000');
    expect(inputs.dirty.value).toBe(true);
    expect(model.value).toEqual([1, 2, 3, 255]);
    await inputs.commit();
    expect(model.value).toEqual([255, 128, 0, 255]);
    await wrapper.get('.color-picker-text-input').setValue('invalid');
    await expect(inputs.commit()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    inputs.cancel();
    expect(inputs.dirty.value).toBe(false);
  });

  it('captures panel adjustments and keeps panel cancellation local to that action', async () => {
    const inputs = createFieldInputs(ref('one'));
    const model = ref<number[]>([10, 20, 30, 255]);
    wrapper = mount(
      {
        setup() {
          provideFieldInputs(inputs);
          return () =>
            h(ColorPicker, {
              modelValue: model.value,
              label: '颜色',
              'onUpdate:modelValue': (value) => {
                model.value = value as number[];
              },
            });
        },
      },
      { global: { stubs: editorUiStubs } },
    );
    await wrapper.get('button.color-picker-preview').trigger('click');
    expect(inputs.dirty.value).toBe(false);
    await wrapper.get('.color-picker-channel-input').setValue('128');
    expect(inputs.dirty.value).toBe(true);
    await inputs.commit();
    const saved = [...model.value];
    expect(saved[0]).toBeGreaterThan(120);
    await wrapper.get('button.color-picker-preview').trigger('click');
    await wrapper.get('.color-picker-channel-input').setValue('0');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '取消')!
      .trigger('click');
    expect(inputs.dirty.value).toBe(false);
    expect(model.value).toEqual(saved);
  });
});
