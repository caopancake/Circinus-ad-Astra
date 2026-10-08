import { onScopeDispose, type Ref } from 'vue';
import {
  useEditTargetDraftSession,
  type EditTargetDraftSession,
  type EditTargetDraftSessionOptions,
} from '@/app/composables/use-edit-target-draft-session';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';

type ConfigEditorDraftSessionOptions<TValue, TTarget, TLoadMeta, TSaveMeta> = EditTargetDraftSessionOptions<
  TValue,
  TTarget,
  TLoadMeta,
  TSaveMeta
> & {
  modRoot: Readonly<Ref<string | null>>;
};

export function useConfigEditorDraftSession<TValue, TTarget, TLoadMeta = unknown, TSaveMeta = unknown>(
  options: ConfigEditorDraftSessionOptions<TValue, TTarget, TLoadMeta, TSaveMeta>,
): EditTargetDraftSession<TValue, TTarget, TLoadMeta, TSaveMeta> {
  const draftSession = useEditTargetDraftSession(options);
  const draftSessions = useDraftSessionsStore();
  const { confirmDiscard } = useFieldInputActions(draftSession.inputs);
  onScopeDispose(draftSessions.registerDraftSession(options.modRoot, draftSession.dirty));
  onScopeDispose(draftSession.dispose);
  return {
    ...draftSession,
    loadPendingExternal: () =>
      confirmDiscard(draftSession.loadPendingExternal, draftSession.dirty.value, () => draftSession.currentTargetKey.value),
  };
}
