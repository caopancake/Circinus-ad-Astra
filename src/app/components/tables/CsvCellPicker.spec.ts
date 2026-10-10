import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelectOption } from '@/domain/schema/schema-options';
import CsvCellPicker from './CsvCellPicker.vue';
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));

vi.mock('@/services/resource-media.service', () => ({
  ensureResourceMedia: vi.fn().mockResolvedValue({ failedResources: [], uncachedDataUrls: new Map() }),
  resourceMediaDataUrl: vi.fn().mockReturnValue(undefined),
  subscribeResourceMediaInvalidations: vi.fn(() => () => {}),
}));

function mountPicker(
  anchor: { height: number; left: number; top: number; width: number },
  props: { multiple?: boolean; options?: SelectOption[]; values?: string[] } = {},
) {
  return mount(CsvCellPicker, {
    props: { anchor, sessionId: 'sess-1', multiple: false, options: [], values: [], ...props },
    global: { plugins: [createPinia()] },
  });
}

describe('CsvCellPicker placement', () => {
  beforeEach(() => {
    vi.stubGlobal('innerHeight', 800);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens downward when the panel fully fits below the anchor', () => {
    const wrapper = mountPicker({ height: 30, left: 40, top: 100, width: 200 });

    const style = wrapper.attributes('style');
    expect(style).toContain('top: 132px');
    expect(style).not.toContain('bottom');
    wrapper.unmount();
  });

  it('flips upward when the downward panel would be clipped by the window edge', () => {
    const wrapper = mountPicker({ height: 30, left: 40, top: 700, width: 200 });

    const style = wrapper.attributes('style');
    expect(style).toContain('bottom: 102px');
    expect(style).not.toContain('top:');
    wrapper.unmount();
  });

  it('keeps the downward side when the window is too short for either side', () => {
    vi.stubGlobal('innerHeight', 60);
    const wrapper = mountPicker({ height: 30, left: 40, top: 10, width: 200 });

    const style = wrapper.attributes('style');
    expect(style).toContain('top: 42px');
    expect(style).not.toContain('bottom');
    wrapper.unmount();
  });

  it('offers a clear action for single-select with a current value', async () => {
    const wrapper = mountPicker({ height: 30, left: 40, top: 100, width: 200 }, { values: ['phase'] });

    await wrapper.find('.csv-cell-picker-clear').trigger('click');

    expect(wrapper.emitted('commit')).toEqual([[['']]]);
    wrapper.unmount();
  });

  it('hides the clear action when no value is selected', () => {
    const wrapper = mountPicker({ height: 30, left: 40, top: 100, width: 200 });

    expect(wrapper.find('.csv-cell-picker-clear').exists()).toBe(false);
    wrapper.unmount();
  });

  it('hides the clear action for multiple select', () => {
    const wrapper = mountPicker({ height: 30, left: 40, top: 100, width: 200 }, { multiple: true, values: ['a', 'b'] });

    expect(wrapper.find('.csv-cell-picker-clear').exists()).toBe(false);
    wrapper.unmount();
  });

  it('keeps search local and exposes custom input as pending work', async () => {
    const wrapper = mountPicker({ height: 30, left: 40, top: 100, width: 200 }, { values: ['A'], multiple: true });
    await wrapper.get('.csv-cell-picker-search').setValue('search only');
    expect(wrapper.emitted('pending-custom')).toBeUndefined();
    await wrapper.get('.csv-cell-picker-action').trigger('click');
    await wrapper.get('.csv-cell-picker-custom').setValue(' B ');
    expect(wrapper.emitted('pending-custom')?.at(-1)).toEqual([true]);
    expect(wrapper.vm.captureValues()).toEqual(['A', 'B']);
    expect(wrapper.emitted('pending-custom')?.at(-1)).toEqual([false]);
    wrapper.unmount();
  });

  it('keeps the floating panel inside a narrow viewport and follows resizing', async () => {
    vi.stubGlobal('innerWidth', 480);
    const wrapper = mountPicker({ height: 30, left: 420, top: 100, width: 200 });
    expect(wrapper.attributes('style')).toContain('left: 176px');
    expect(wrapper.attributes('style')).toContain('width: 300px');
    vi.stubGlobal('innerWidth', 280);
    window.dispatchEvent(new Event('resize'));
    await wrapper.vm.$nextTick();
    expect(wrapper.attributes('style')).toContain('left: 4px');
    expect(wrapper.attributes('style')).toContain('width: 272px');
    wrapper.unmount();
  });
});
