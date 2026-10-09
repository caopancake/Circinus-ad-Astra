import { onMounted, onUnmounted } from 'vue';
import type { AppFeedback, AssociatedSpecChange } from '@/shared/types';
import type { AssociatedSpecCandidate } from '@/domain/tables/associated-spec-candidates';
import { listenEntityTablePreparation } from '@/orchestrators/entity-identity.orchestrator';
import { useSettingsStore } from '@/stores/settings.store';
import { listenWindowSaveEvents } from '@/orchestrators/window-save.orchestrator';
import { removeLoadedModRuntime } from '@/orchestrators/workspace-lifecycle.orchestrator';
import {
  restorePersistedWorkspace,
  watchWorkspacePersistence,
  type WorkspacePersistenceWatcher,
} from '@/orchestrators/workspace-persistence.orchestrator';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useCoreSchema } from '@/app/composables/use-core-assets';
import { recordLogBestEffort } from '@/services/app-feedback-log.service';
import { buildModOpeningFailure } from '@/shared/lib/errors';

// Main-window-only bootstrap: startup restore, workspace-state persistence and
// window save events run once per application shell, never per page component.
export function useWorkspaceShellLifecycle(
  feedback: AppFeedback,
  selectAssociatedSpecs: (candidates: AssociatedSpecCandidate[]) => Promise<AssociatedSpecChange[] | null>,
) {
  const settings = useSettingsStore();
  const workspace = useWorkspaceStore();
  const { loadCoreFields } = useCoreSchema();
  let stopWindowSaveEvents: (() => void) | null = null;
  let stopIdentityPreparation: (() => void) | null = null;
  let workspacePersistence: WorkspacePersistenceWatcher | null = null;

  onMounted(async () => {
    stopIdentityPreparation = await listenEntityTablePreparation(feedback, selectAssociatedSpecs);
    recordLogBestEffort({
      level: 'info',
      code: 'app.started',
      message: 'app started',
      path: null,
      line: null,
      fields: { version: __APP_VERSION__ },
    });
    workspacePersistence = watchWorkspacePersistence();
    stopWindowSaveEvents = await listenWindowSaveEvents({
      onEditorSpecSaved: (event) => {
        recordLogBestEffort({
          level: 'info',
          code: 'editor.spec_saved',
          message: 'editor spec saved',
          path: null,
          line: null,
          fields: {
            kind: event.kind,
            id: event.id,
            modRoot: event.modRoot,
            sessionId: event.sessionId,
            changes: String(event.writeResult.changes.length),
          },
        });
        feedback.success(`${event.id} 已保存`);
      },
    });
    const persistence = workspacePersistence;
    let shouldPersistRestoredWorkspace = false;
    try {
      persistence.beginRestore();
      await restorePersistedWorkspace({
        knownStarsectorRoot: settings.starsectorRoot,
        loadCoreFields,
        onModRestoreError: async (modRoot, displayName, error) => {
          await removeLoadedModRuntime(modRoot);
          workspace.setModOpeningFailure(buildModOpeningFailure(modRoot, error));
          feedback.error(error, `恢复 ${displayName} 失败`);
        },
        onModRestoreWarnings: (displayName, warnings) => {
          for (const warning of warnings) {
            feedback.warning({ ...warning, userMessage: `${displayName}：${warning.userMessage}` });
          }
        },
      });
      shouldPersistRestoredWorkspace = true;
    } catch (error) {
      feedback.error(error, '恢复工作区状态失败');
    } finally {
      try {
        await persistence.finishRestore(shouldPersistRestoredWorkspace);
      } catch (error) {
        feedback.error(error, '保存工作区状态失败');
      }
    }
  });

  onUnmounted(() => {
    recordLogBestEffort({
      level: 'info',
      code: 'app.exited',
      message: 'app exited',
      path: null,
      line: null,
      fields: { version: __APP_VERSION__ },
    });
    stopWindowSaveEvents?.();
    stopIdentityPreparation?.();
    stopWindowSaveEvents = null;
    workspacePersistence?.stop();
    workspacePersistence = null;
  });
}
