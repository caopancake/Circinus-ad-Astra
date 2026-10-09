import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { clearConfig, openConfigFolder } from '@/services/app-config.service';
import { reloadCurrentWindow } from '@/windows/current.window';

export function useAppConfigActions(afterClear: () => Promise<void>) {
  const feedback = useAppFeedback();
  async function openConfigFolderAction() {
    try {
      await openConfigFolder();
    } catch (error) {
      feedback.error(error, '打开配置文件夹失败');
    }
  }
  function confirmClearConfig() {
    feedback.confirmDanger({
      title: '清空配置文件',
      content: '将删除工具配置目录内的设置、工作区记录及缓存子目录，并保留正式 log 文件。确认清空？',
      actionText: '清空',
      onConfirm: async () => {
        try {
          await clearConfig();
          await afterClear();
          feedback.success('配置文件已清空');
          await reloadCurrentWindow();
        } catch (error) {
          feedback.error(error, '清空配置文件失败');
        }
      },
    });
  }
  return { openConfigFolderAction, confirmClearConfig };
}
