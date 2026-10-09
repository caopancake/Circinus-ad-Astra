import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import GameOverviewPanel from '@/app/components/GameOverviewPanel.vue';
import { nButtonStub } from '@/test/stubs';
import type { GameOverviewData, GameScanWarning, ModOpeningFailure } from '@/shared/types';

vi.mock('@/stores/workspace.store', () => ({
  useWorkspaceStore: () => ({ activeModRoot: null, isModImported: () => false, isModView: false, mods: new Map() }),
}));
vi.mock('@/app/composables/use-workspace-navigation-actions', () => ({
  useWorkspaceNavigationActions: () => ({ navigateToModOverview: vi.fn() }),
}));

const warning: GameScanWarning = {
  code: 'parse.json_syntax',
  location: { path: 'D:/game/mods/broken/mod_info.json', line: 5, column: 44 },
  path: 'D:\\game\\mods\\broken\\mod_info.json',
  message: '读取 mod_info.json 失败: 解析 JSON 文件失败 (D:\\game\\mods\\broken\\mod_info.json): expected `,` or `}` at line 5 column 44',
  editTarget: {
    modRoot: 'D:\\game\\mods\\broken',
    path: 'D:\\game\\mods\\broken\\mod_info.json',
  },
};

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('GameOverviewPanel warning file actions', () => {
  it('renders the recovery button and emits the structured warning', async () => {
    wrapper = mountPanel([warning]);

    const item = wrapper.get('.game-warning-item');
    expect(item.text()).toContain('第 5 行，第 44 列');
    expect(item.get('button').text()).toBe('打开文件');

    await item.get('button').trigger('click');

    expect(wrapper.emitted('edit-warning-file')).toEqual([[warning]]);
  });

  it('renders Mod opening failures before scan warnings', () => {
    const failure: ModOpeningFailure = {
      diagnostic: { code: 'parse.csv', message: 'raw CSV detail', location: null },
      modRoot: 'D:\\game\\mods\\broken',
      message: '解析 CSV 失败',
      file: null,
    };
    wrapper = mountPanel([warning], [failure]);

    const children = wrapper.get('.game-overview').element.children;
    expect(children[1]?.classList.contains('mod-opening-failure-list')).toBe(true);
    expect(children[2]?.classList.contains('game-warning-list')).toBe(true);
  });

  it('keeps non-editable warnings without a file button', () => {
    wrapper = mountPanel([
      { code: 'scan.core_missing', location: null, path: 'D:\\game\\starsector-core', message: '缺少 starsector-core', editTarget: null },
    ]);

    expect(wrapper.get('.game-warning-item').find('button').exists()).toBe(false);
  });
});

function mountPanel(warnings: GameScanWarning[], openingFailures: ModOpeningFailure[] = []): VueWrapper {
  const overview: GameOverviewData = {
    starsectorRoot: 'D:\\game',
    coreAvailable: true,
    modsDir: 'D:\\game\\mods',
    mods: [],
    warnings,
  };
  return mount(GameOverviewPanel, {
    props: { openingFailures, overview },
    global: {
      stubs: {
        'n-button': nButtonStub,
      },
    },
  });
}
