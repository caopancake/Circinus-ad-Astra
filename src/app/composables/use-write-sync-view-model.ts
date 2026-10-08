import { computed, ref } from 'vue';
import { useWriteSyncStore } from '@/stores/write-sync.store';
import { useProjectStore } from '@/stores/project.store';
import { retryPendingProjectSessionWrites } from '@/orchestrators/project-session-refresh.orchestrator';
import { useAppFeedback } from '@/app/composables/use-app-feedback';

export function useWriteSyncViewModel() {
  const sync = useWriteSyncStore();
  const project = useProjectStore();
  const feedback = useAppFeedback();
  const retrying = ref(false);
  const failedCount = computed(() => sync.pending.filter((entry) => entry.error !== null).length);
  async function retry() {
    retrying.value = true;
    try {
      for (const sessionId of new Set(sync.pending.map((entry) => entry.sessionId))) {
        await retryPendingProjectSessionWrites(project, sessionId);
      }
    } catch (error) {
      feedback.error(error, '同步已保存内容失败');
    } finally {
      retrying.value = false;
    }
  }
  return { failedCount, retrying, retry };
}
