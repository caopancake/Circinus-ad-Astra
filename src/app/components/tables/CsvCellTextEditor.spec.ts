import { mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CsvCellTextEditor from './CsvCellTextEditor.vue';

function mountEditor(anchor: { height: number; left: number; top: number; width: number }, value = '原文') {
  const wrapper = mount(CsvCellTextEditor, {
    props: {
      anchor,
      value,
      onUpdate: (text: string) => {
        void wrapper.setProps({ value: text });
      },
    },
  });
  return wrapper;
}

function outsideMouseDown() {
  const outside = document.createElement('div');
  document.body.appendChild(outside);
  outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  outside.remove();
}

describe('CsvCellTextEditor', () => {
  beforeEach(() => {
    vi.stubGlobal('innerHeight', 800);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens downward when the editor fully fits below the anchor', () => {
    const wrapper = mountEditor({ height: 30, left: 40, top: 100, width: 200 });

    const style = wrapper.attributes('style');
    expect(style).toContain('top: 132px');
    expect(style).toContain('height: 260px');
    expect(style).not.toContain('bottom');
    wrapper.unmount();
  });

  it('flips upward when the editor would be clipped by the window edge', () => {
    const wrapper = mountEditor({ height: 30, left: 40, top: 700, width: 200 });

    const style = wrapper.attributes('style');
    expect(style).toContain('bottom: 102px');
    expect(style).not.toContain('top:');
    wrapper.unmount();
  });

  it('commits the edited draft on ctrl+enter', async () => {
    const wrapper = mountEditor({ height: 30, left: 40, top: 100, width: 200 }, '第一行');
    await wrapper.find('textarea').setValue('第一行\n第二行');

    await wrapper.find('textarea').trigger('keydown.enter.ctrl');

    expect(wrapper.emitted('commit')).toEqual([['第一行\n第二行']]);
    expect(wrapper.emitted('commit')).toHaveLength(1);
    wrapper.unmount();
  });

  it('closes without committing on esc', async () => {
    const wrapper = mountEditor({ height: 30, left: 40, top: 100, width: 200 });
    await wrapper.find('textarea').setValue('改动');

    await wrapper.find('textarea').trigger('keydown.esc');

    expect(wrapper.emitted('commit')).toBeUndefined();
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    wrapper.unmount();
  });

  it('commits the draft and closes on outside mousedown', async () => {
    const wrapper = mountEditor({ height: 30, left: 40, top: 100, width: 200 });
    await wrapper.find('textarea').setValue('外部提交');

    outsideMouseDown();

    expect(wrapper.emitted('commit')).toEqual([['外部提交']]);
    expect(wrapper.emitted('commit')).toHaveLength(1);
    wrapper.unmount();
  });

  it('ignores outside mousedown after the editor already settled', async () => {
    const wrapper = mountEditor({ height: 30, left: 40, top: 100, width: 200 });
    await wrapper.find('textarea').trigger('keydown.esc');

    outsideMouseDown();

    expect(wrapper.emitted('commit')).toBeUndefined();
    expect(wrapper.emitted('cancel')).toHaveLength(1);
    wrapper.unmount();
  });
});
