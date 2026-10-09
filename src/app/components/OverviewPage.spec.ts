import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import OverviewPage from '@/app/components/OverviewPage.vue';
import { nButtonStub } from '@/test/stubs';
import { useWorkspaceStore } from '@/stores/workspace.store';

vi.mock('@/app/composables/config/use-create-mod-view-model', async () => {
  const { ref } = await import('vue');
  return {
    useCreateModViewModel: () => ({
      beginCreateMod: vi.fn(),
      destinationText: ref('D:\\mods'),
      saving: ref(false),
      submitCreateMod: vi.fn(),
      template: ref({ id: '', name: '', version: '', gameVersion: '' }),
      visible: ref(false),
    }),
  };
});

let wrapper: VueWrapper | null = null;

beforeEach(() => setActivePinia(createPinia()));

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('OverviewPage external Mod opening failures', () => {
  it('keeps the overview actions visible with a red runtime failure', async () => {
    const workspace = useWorkspaceStore();
    workspace.setModOpeningFailure({
      diagnostic: { code: 'parse.csv', message: 'raw CSV detail', location: null },
      modRoot: 'D:\\mods\\broken',
      message: '解析 CSV 失败',
      file: { path: 'D:\\mods\\broken\\data.csv', line: 3 },
    });

    wrapper = mount(OverviewPage, {
      global: {
        stubs: {
          GameOverviewPanel: true,
          LoadedModsPanel: true,
          'n-button': nButtonStub,
          'n-input': true,
          'n-modal': true,
        },
      },
    });

    expect(wrapper.get('.overview-header').text()).toContain('1 个 Mod 打开失败');
    expect(wrapper.get('.mod-opening-failure-item').text()).toContain('解析 CSV 失败');
    const buttons = wrapper.findAll('button').map((button) => button.text());
    expect(buttons).toContain('打开文件');
    expect(buttons).toContain('打开目录');
  });
});
