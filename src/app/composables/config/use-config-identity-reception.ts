import { onMounted, onScopeDispose, ref, shallowRef } from 'vue';
import { listenEntityIdentityApplied } from '@/orchestrators/entity-events.orchestrator';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { normalizeFsPath } from '@/shared/lib/paths';
import type { ConfigIdentityHandoff, EntityEditTarget } from '@/shared/types';

export function useConfigIdentityReception<T>(options: {
  target: () => { sessionId: string; modRoot: string; kind: EntityEditTarget['kind']; id: string } | null;
  read: (sessionId: string, id: string) => Promise<T | null>;
  accept: (record: T, id: string) => void;
}) {
  const receiving = ref(false);
  const handoff = shallowRef<ConfigIdentityHandoff<T> | null>(null);
  const feedback = useAppFeedback();
  let stop: (() => void) | null = null;
  let disposed = false;
  let sequence = 0;
  onMounted(async () => {
    const listener = await listenEntityIdentityApplied(async (event) => {
      const target = options.target();
      if (!target || target.sessionId !== event.sessionId || normalizeFsPath(target.modRoot) !== normalizeFsPath(event.modRoot)) return;
      const change = event.result.identityChanges.find(
        (change) => change.before.kind === target.kind && change.before.id === target.id && change.before.id !== change.after.id,
      );
      if (!change) return;
      const request = ++sequence;
      const current = () =>
        !disposed && request === sequence && options.target()?.id === target.id && options.target()?.sessionId === target.sessionId;
      receiving.value = true;
      try {
        await Promise.resolve();
        const saving = useSaveCommandStore().waitForSaves(target.modRoot);
        if (saving && !(await saving)) return;
        if (!current()) return;
        const record = await options.read(target.sessionId, change.after.id);
        if (!record || !current()) return;
        const preserveDraft = useDraftSessionsStore().hasDirtyDraftForMod(target.modRoot);
        if (preserveDraft) {
          const choice = await feedback.choose({
            title: '跟随实体重命名？',
            content: '保留当前草稿与活动输入，并接纳新的正式身份和文件基线。',
            choices: [{ label: '保留编辑并跟随', value: 'follow', type: 'primary' }],
          });
          if (choice !== 'follow' || !current()) return;
        }
        handoff.value = { sourceId: target.id, record, preserveDraft, commitId: event.result.commitId };
        options.accept(record, change.after.id);
      } catch (error) {
        if (current()) feedback.error(error, '同步配置实体身份失败');
      } finally {
        if (request === sequence) receiving.value = false;
      }
    });
    if (disposed) listener();
    else stop = listener;
  });
  onScopeDispose(() => {
    disposed = true;
    sequence++;
    stop?.();
  });
  return { receiving, handoff };
}
