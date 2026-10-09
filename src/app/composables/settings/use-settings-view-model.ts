import { computed, ref } from 'vue';
import { pickDirectoryDialog } from '@/shared/runtime/dialog.runtime';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { clearLog, loadLogStatus, openLogFile } from '@/services/app-log.service';
import { useAppConfigActions } from '@/app/composables/settings/use-app-config-actions';
import { useSettingsStore } from '@/stores/settings.store';
import { saveLogDirectory } from '@/orchestrators/settings-persistence.orchestrator';

export function useSettingsViewModel() {
  const settings = useSettingsStore();
  const feedback = useAppFeedback();
  const logSizeBytes = ref(0);
  const logPath = ref('');
  const formattedLogSize = computed(() => formatBytes(logSizeBytes.value));
  const logPathHint = computed(() => (logPath.value ? `Log 文件: ${logPath.value}` : 'Log 文件尚未创建。'));
  const configActions = useAppConfigActions(refreshLogStatus);

  async function pickStarsectorRoot() {
    const selected = await pickDirectoryDialog('选择 Starsector 安装目录');
    if (selected) {
      settings.setStarsectorRoot(selected);
    }
  }

  async function pickLogDirectory() {
    const selected = await pickDirectoryDialog('选择日志输出目录');
    if (!selected || typeof selected !== 'string') return;
    try {
      await saveLogDirectory(selected);
      await refreshLogStatus();
      feedback.success('日志输出目录已更新');
    } catch (error) {
      feedback.error(error, '保存日志输出目录失败');
    }
  }

  async function restoreDefaultLogDirectory() {
    try {
      await saveLogDirectory(null);
      await refreshLogStatus();
      feedback.success('日志输出目录已恢复默认位置');
    } catch (error) {
      feedback.error(error, '恢复默认日志输出目录失败');
    }
  }

  async function refreshLogStatus() {
    try {
      const status = await loadLogStatus();
      logSizeBytes.value = status.sizeBytes;
      logPath.value = status.path;
    } catch (error) {
      feedback.error(error, '读取 log 状态失败');
    }
  }

  async function openLogFileAction() {
    try {
      await openLogFile();
      await refreshLogStatus();
    } catch (error) {
      feedback.error(error, '打开 log 文件失败');
    }
  }

  function confirmClearLog() {
    feedback.confirmDanger({
      title: '清除 log 文件',
      content: '将清空当前 log 文件内容。确认清除？',
      actionText: '清除',
      onConfirm: async () => {
        try {
          const status = await clearLog();
          logSizeBytes.value = status.sizeBytes;
          logPath.value = status.path;
          feedback.success('log 文件已清除');
        } catch (error) {
          feedback.error(error, '清除 log 文件失败');
        }
      },
    });
  }

  return {
    formattedLogSize,
    logPathHint,
    pickLogDirectory,
    pickStarsectorRoot,
    refreshLogStatus,
    openConfigFolderAction: configActions.openConfigFolderAction,
    openLogFileAction,
    restoreDefaultLogDirectory,
    confirmClearConfig: configActions.confirmClearConfig,
    confirmClearLog,
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
