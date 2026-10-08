import { computed, ref, type Ref } from 'vue';
import { createEditSessionValue, type EditSessionValueOptions } from '@/domain/edit-session';

const DEFAULT_EXTERNAL_NOTICE = '外部版本已更新，当前未保存草稿已保留。';

export interface DraftSessionOptions<T> extends EditSessionValueOptions<T> {
  externalNotice?: string;
}

export interface DraftSession<T> {
  baseValue: Ref<T>;
  dirty: Ref<boolean>;
  draftValue: Ref<T>;
  externalUpdateNotice: Ref<string>;
  hasPendingExternalValue: Ref<boolean>;
  pendingExternalValue: Ref<T | null>;
  revision: Ref<number>;
  applyExternal: (value: T, preserveDraft?: boolean) => void;
  clear: (value: T) => void;
  commitSaved: (value?: T) => void;
  commitSavedBaseline: (value: T) => void;
  loadBase: (value: T) => void;
  loadPendingExternal: () => void;
  resetDraft: () => void;
  setDraft: (value: T) => void;
}

export function useDraftSession<T>(initialValue: T, options: DraftSessionOptions<T> = {}): DraftSession<T> {
  const { externalNotice, ...sessionOptions } = options;
  const session = createEditSessionValue(initialValue, sessionOptions);

  // The session is a plain (non-reactive) state machine; the refs below are the reactive
  // projection kept in sync at the single dispatch boundary. Computeds must not read the
  // session getters directly: plain getters never invalidate, so the value would be cached.
  const baseValue = ref<T>(session.baseline) as Ref<T>;
  const draftProjection = ref<T>(session.draft) as Ref<T>;
  const draftValue = computed({
    get: () => draftProjection.value,
    set: (value: T) => dispatch(() => session.setDraft(value)),
  });
  const pendingExternalValue = ref<T | null>(session.pendingExternal) as Ref<T | null>;
  const revision = ref(session.revision);
  const dirty = ref(session.dirty);
  const hasPendingExternalValue = ref(session.hasPendingExternal);

  function dispatch(action: () => void): void {
    action();
    baseValue.value = session.baseline;
    draftProjection.value = session.draft;
    pendingExternalValue.value = session.pendingExternal;
    revision.value = session.revision;
    dirty.value = session.dirty;
    hasPendingExternalValue.value = session.hasPendingExternal;
  }

  const externalUpdateNotice = computed(() => (hasPendingExternalValue.value ? (externalNotice ?? DEFAULT_EXTERNAL_NOTICE) : ''));

  return {
    baseValue,
    dirty,
    draftValue,
    externalUpdateNotice,
    hasPendingExternalValue,
    pendingExternalValue,
    revision,
    applyExternal: (value, preserveDraft) => dispatch(() => session.applyExternal(value, preserveDraft)),
    clear: (value) => dispatch(() => session.clear(value)),
    commitSaved: (value) => dispatch(() => session.commitSaved(value)),
    commitSavedBaseline: (value) => dispatch(() => session.commitSavedBaseline(value)),
    loadBase: (value) => dispatch(() => session.loadBaseline(value)),
    loadPendingExternal: () => dispatch(() => session.loadPendingExternal()),
    resetDraft: () => dispatch(() => session.resetDraft()),
    setDraft: (value) => dispatch(() => session.setDraft(value)),
  };
}
