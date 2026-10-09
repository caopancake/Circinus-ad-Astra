import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import ModOpeningFailureList from '@/app/components/ModOpeningFailureList.vue';
import { nButtonStub } from '@/test/stubs';
import type { ModOpeningFailure } from '@/shared/types';

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('ModOpeningFailureList', () => {
  it('renders an authorized file action and emits the structured failure', async () => {
    const failure = editableFailure();
    wrapper = mountList([failure]);

    expect(wrapper.get('.mod-opening-failure-item').text()).toContain('第 5 行');
    expect(wrapper.get('button').text()).toBe('打开文件');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('edit-failure-file')).toEqual([[failure]]);
  });

  it('renders an error without a file action', () => {
    wrapper = mountList([
      {
        modRoot: 'D:\\mods\\demo',
        message: '打开失败',
        file: null,
        diagnostic: { code: 'unknown', message: 'Open failed', location: null },
      },
    ]);
    expect(wrapper.get('.mod-opening-failure-item').text()).toContain('打开失败');
    expect(wrapper.find('button').exists()).toBe(false);
  });
});

function mountList(failures: ModOpeningFailure[]): VueWrapper {
  return mount(ModOpeningFailureList, {
    props: { failures },
    global: {
      stubs: {
        'n-button': nButtonStub,
      },
    },
  });
}

function editableFailure(): ModOpeningFailure {
  return {
    diagnostic: { code: 'parse.csv', message: 'raw CSV detail', location: null },
    modRoot: 'D:\\mods\\demo',
    message: '解析 CSV 失败 (D:\\mods\\demo\\data.csv): record starts at line 5',
    file: { path: 'D:\\mods\\demo\\data.csv', line: 5 },
  };
}
