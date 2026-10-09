import { computed, ref } from 'vue';
import { useWriteSyncStore } from '@/stores/write-sync.store';
import { retryPendingProjectSessionWrites } from '@/orchestrators/project-session-refresh.orchestrator';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { AppError } from '@/shared/lib/errors';

export function useWriteSyncViewModel() {
  const sync = useWriteSyncStore();
  const feedback = useAppFeedback();
  const retrying = ref(false);
  const failedCount = computed(() => sync.pending.filter((entry) => entry.error !== null).length);
  async function retry() {
    retrying.value = true;
    try {
      const waiting = useSaveCommandStore().waitForSaves();
      if (waiting && !(await waiting)) throw new AppError('所属编辑会话同步失败', { action: 'retry-committed-write' });
      for (const sessionId of new Set(
        sync.pending.flatMap((entry) =>
          entry.event.sessionId ? [entry.event.sessionId] : entry.event.result.sessionUpdates.map((update) => update.sessionId),
        ),
      )) {
        await retryPendingProjectSessionWrites(sessionId);
      }
    } catch (error) {
      feedback.error(error, '同步已保存内容失败');
    } finally {
      retrying.value = false;
    }
  }
  return { failedCount, retrying, retry };
}
