import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
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
});
