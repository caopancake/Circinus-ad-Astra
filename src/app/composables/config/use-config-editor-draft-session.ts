import { onScopeDispose, type Ref } from 'vue';
import {
  useEditTargetDraftSession,
  type EditTargetDraftSession,
  type EditTargetDraftSessionOptions,
} from '@/app/composables/use-edit-target-draft-session';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { useSaveCommandStore } from '@/stores/save-command.store';

type ConfigEditorDraftSessionOptions<TValue, TTarget, TMeta> = EditTargetDraftSessionOptions<TValue, TTarget, TMeta> & {
  modRoot: Readonly<Ref<string | null>>;
};

export function useConfigEditorDraftSession<TValue, TTarget, TMeta = unknown>(
  options: ConfigEditorDraftSessionOptions<TValue, TTarget, TMeta>,
): EditTargetDraftSession<TValue, TTarget, TMeta> {
  const draftSession = useEditTargetDraftSession(options);
  const draftSessions = useDraftSessionsStore();
  const { confirmDiscard } = useFieldInputActions(draftSession.inputs);
  onScopeDispose(draftSessions.registerDraftSession(options.modRoot, draftSession.dirty));
  const commands = useSaveCommandStore();
  onScopeDispose(
    commands.registerSaveSession({
      targetKey: draftSession.currentTargetKey,
      modRoot: options.modRoot,
      saving: draftSession.saving,
      waitForSave: draftSession.waitForSave,
    }),
  );
  onScopeDispose(draftSession.dispose);
  return {
    ...draftSession,
    loadPendingExternal: () => {
      const key = draftSession.currentTargetKey.value;
      const adopt = () => {
        if (key === draftSession.currentTargetKey.value)
          confirmDiscard(draftSession.loadPendingExternal, draftSession.dirty.value, () => draftSession.currentTargetKey.value);
      };
      const pending = commands.waitForSaves(options.modRoot.value, key);
      if (pending)
        void pending.then((saved) => {
          if (saved) adopt();
        });
      else adopt();
    },
  };
}
