import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  feedback: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  },
  pickDirectoryDialog: vi.fn(async () => null as string | null),
  saveLogDirectory: vi.fn(async () => {}),
  loadLogStatus: vi.fn(async () => ({ path: 'C:/log/app.log', sizeBytes: 0 })),
  openConfigFolder: vi.fn(async () => {}),
  openLogFile: vi.fn(async () => {}),
  clearConfig: vi.fn(async () => {}),
  clearLog: vi.fn(async () => ({ path: 'C:/log/app.log', sizeBytes: 0 })),
  reloadCurrentWindow: vi.fn(async () => {}),
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));

vi.mock('@/shared/runtime/dialog.runtime', () => ({
  pickDirectoryDialog: mocks.pickDirectoryDialog,
}));

vi.mock('@/services/app-log.service', () => ({
  loadLogStatus: mocks.loadLogStatus,
  openConfigFolder: mocks.openConfigFolder,
  openLogFile: mocks.openLogFile,
  clearConfig: mocks.clearConfig,
  clearLog: mocks.clearLog,
}));

vi.mock('@/services/app-config.service', () => ({ openConfigFolder: mocks.openConfigFolder, clearConfig: mocks.clearConfig }));

vi.mock('@/orchestrators/settings-persistence.orchestrator', () => ({
  saveLogDirectory: mocks.saveLogDirectory,
}));

vi.mock('@/windows/current.window', () => ({
  reloadCurrentWindow: mocks.reloadCurrentWindow,
}));

import { useSettingsViewModel } from './use-settings-view-model';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';

const DEFAULT_SETTINGS = {
  theme: 'light',
  accent: 'blue',
  customAccent: '#3388cc',
  historyLimit: 20,
  editMode: 'smart',
  starsectorRoot: null,
  logDirectory: null,
  logLevel: 'info',
} as const;

describe('useSettingsViewModel', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore({ ...DEFAULT_SETTINGS });
    vi.clearAllMocks();
  });

  it('formats log sizes in bytes, kilobytes and megabytes', async () => {
    const viewModel = useSettingsViewModel();
    mocks.loadLogStatus.mockResolvedValue({ path: 'C:/log/app.log', sizeBytes: 512 });
    await viewModel.refreshLogStatus();
    expect(viewModel.formattedLogSize.value).toBe('512 B');

    mocks.loadLogStatus.mockResolvedValue({ path: 'C:/log/app.log', sizeBytes: 2048 });
    await viewModel.refreshLogStatus();
    expect(viewModel.formattedLogSize.value).toBe('2.0 KB');

    mocks.loadLogStatus.mockResolvedValue({ path: 'C:/log/app.log', sizeBytes: 3 * 1024 * 1024 });
    await viewModel.refreshLogStatus();
    expect(viewModel.formattedLogSize.value).toBe('3.0 MB');
  });

  it('hints about the log path once a status is loaded', async () => {
    const viewModel = useSettingsViewModel();
    expect(viewModel.logPathHint.value).toContain('尚未创建');
    mocks.loadLogStatus.mockResolvedValue({ path: 'C:/log/app.log', sizeBytes: 10 });
    await viewModel.refreshLogStatus();
    expect(viewModel.logPathHint.value).toBe('Log 文件: C:/log/app.log');
  });

  it('stores a picked starsector root in the settings store', async () => {
    mocks.pickDirectoryDialog.mockResolvedValue('D:/games/starsector');
    const viewModel = useSettingsViewModel();
    await viewModel.pickStarsectorRoot();
    expect(useSettingsStore().starsectorRoot).toBe('D:/games/starsector');
  });

  it('ignores a cancelled starsector directory pick', async () => {
    mocks.pickDirectoryDialog.mockResolvedValue(null);
    const viewModel = useSettingsViewModel();
    await viewModel.pickStarsectorRoot();
    expect(useSettingsStore().starsectorRoot).toBeNull();
  });
  it('persists a picked log directory and refreshes the status', async () => {
    mocks.pickDirectoryDialog.mockResolvedValue('C:/custom-log');
    mocks.loadLogStatus.mockResolvedValue({ path: 'C:/custom-log/app.log', sizeBytes: 0 });
    const viewModel = useSettingsViewModel();
    await viewModel.pickLogDirectory();
    expect(mocks.saveLogDirectory).toHaveBeenCalledWith('C:/custom-log');
    expect(mocks.feedback.success).toHaveBeenCalledWith('日志输出目录已更新');
    expect(viewModel.logPathHint.value).toContain('C:/custom-log');
  });

  it('reports log directory save failures', async () => {
    mocks.pickDirectoryDialog.mockResolvedValue('C:/custom-log');
    mocks.saveLogDirectory.mockRejectedValue(new Error('denied'));
    const viewModel = useSettingsViewModel();
    await viewModel.pickLogDirectory();
    expect(mocks.feedback.error).toHaveBeenCalledTimes(1);
  });

  it('restores the default log directory', async () => {
    mocks.pickDirectoryDialog.mockResolvedValue(null);
    mocks.loadLogStatus.mockResolvedValue({ path: 'C:/log/app.log', sizeBytes: 0 });
    mocks.saveLogDirectory.mockResolvedValue({ ...DEFAULT_SETTINGS, logDirectory: null } as never);
    const viewModel = useSettingsViewModel();
    await viewModel.restoreDefaultLogDirectory();
    expect(mocks.saveLogDirectory).toHaveBeenCalledWith(null);
    expect(mocks.feedback.success).toHaveBeenCalledWith('日志输出目录已恢复默认位置');
  });

  it('clears config files behind a danger confirmation and reloads', async () => {
    const viewModel = useSettingsViewModel();
    viewModel.confirmClearConfig();
    expect(mocks.feedback.confirmDanger).toHaveBeenCalledTimes(1);
    await mocks.feedback.confirmDanger.mock.calls[0]![0].onConfirm();
    expect(mocks.clearConfig).toHaveBeenCalledTimes(1);
    expect(mocks.feedback.success).toHaveBeenCalledWith('配置文件已清空');
    expect(mocks.reloadCurrentWindow).toHaveBeenCalledTimes(1);
  });

  it('clears the log file behind a danger confirmation', async () => {
    mocks.clearLog.mockResolvedValue({ path: 'C:/log/app.log', sizeBytes: 0 });
    const viewModel = useSettingsViewModel();
    viewModel.confirmClearLog();
    await mocks.feedback.confirmDanger.mock.calls[0]![0].onConfirm();
    expect(mocks.clearLog).toHaveBeenCalledTimes(1);
    expect(mocks.feedback.success).toHaveBeenCalledWith('log 文件已清除');
    expect(viewModel.formattedLogSize.value).toBe('0 B');
  });

  it('reports open failures for config and log locations', async () => {
    mocks.openConfigFolder.mockRejectedValue(new Error('gone'));
    mocks.openLogFile.mockRejectedValue(new Error('gone'));
    const viewModel = useSettingsViewModel();
    await viewModel.openConfigFolderAction();
    await viewModel.openLogFileAction();
    expect(mocks.feedback.error).toHaveBeenCalledTimes(2);
  });
});
