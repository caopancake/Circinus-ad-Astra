import { describe, expect, it, vi } from 'vitest';

const openManagedWindow = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@/windows/managed.window', () => ({ openManagedWindow }));

import { openGameWarningFileEditor, openModOpeningFailureFileEditor } from '@/windows/file-editor.window';
import type { AppSettings, GameScanWarning, ModOpeningFailure } from '@/shared/types';

const settings: AppSettings = {
  theme: 'dark',
  accent: 'blue',
  customAccent: '#2f6feb',
  historyLimit: 50,
  editMode: 'smart',
  starsectorRoot: 'D:\\game',
  logDirectory: null,
  logLevel: 'info',
};

describe('workspace warning file editor window', () => {
  it('opens recovery mode with the structured target and parsed position', async () => {
    const warning = editableWarning();

    await openGameWarningFileEditor(warning, settings);

    expect(openManagedWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        urlParams: expect.objectContaining({
          column: 44,
          file: warning.editTarget?.path,
          line: 5,
          mode: 'recovery',
          modRoot: warning.editTarget?.modRoot,
          sessionId: null,
        }),
      }),
    );
  });

  it('ignores warnings without a structured edit target', () => {
    const result = openGameWarningFileEditor(
      { code: 'scan.mods_missing', location: null, path: 'D:\\game', message: '缺少目录', editTarget: null },
      settings,
    );

    expect(result).toBeNull();
    expect(openManagedWindow).not.toHaveBeenCalled();
  });

  it('opens a Mod opening failure in recovery mode', async () => {
    const failure: ModOpeningFailure = {
      diagnostic: { code: 'parse.csv', message: 'raw CSV detail', location: null },
      modRoot: 'D:\\game\\mods\\broken',
      message: '解析 CSV 失败',
      file: { path: 'D:\\game\\mods\\broken\\data.csv', line: 7 },
    };

    await openModOpeningFailureFileEditor(failure, settings);

    expect(openManagedWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        urlParams: expect.objectContaining({
          file: failure.file?.path,
          line: 7,
          mode: 'recovery',
          modRoot: failure.modRoot,
          sessionId: null,
        }),
      }),
    );
  });
});

function editableWarning(): GameScanWarning {
  return {
    code: 'parse.json_syntax',
    location: { path: 'D:/game/mods/broken/mod_info.json', line: 5, column: 44 },
    path: 'D:\\game\\mods\\broken\\mod_info.json',
    message: '读取 mod_info.json 失败: 解析 JSON 文件失败 (D:\\game\\mods\\broken\\mod_info.json): expected comma at line 5 column 44',
    editTarget: {
      modRoot: 'D:\\game\\mods\\broken',
      path: 'D:\\game\\mods\\broken\\mod_info.json',
    },
  };
}
