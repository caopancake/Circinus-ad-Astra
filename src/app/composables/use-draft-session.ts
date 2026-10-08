import { computed, shallowRef, type Ref } from 'vue';
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
  commitSavedBaseline: (value: T, preservePendingExternal?: boolean) => void;
  loadBase: (value: T) => void;
  loadPendingExternal: () => void;
  resetDraft: () => void;
  setDraft: (value: T) => void;
}

export function useDraftSession<T>(initialValue: T, options: DraftSessionOptions<T> = {}): DraftSession<T> {
  const { externalNotice, ...sessionOptions } = options;
  const session = createEditSessionValue(initialValue, sessionOptions);

  function capture() {
    return {
      base: session.baseline,
      draft: session.draft,
      pending: session.pendingExternal,
      revision: session.revision,
      dirty: session.dirty,
      hasPending: session.hasPendingExternal,
    };
  }
  const projection = shallowRef(capture());
  const baseValue = computed(() => projection.value.base);
  const draftValue = computed({
    get: () => projection.value.draft,
    set: (value: T) => dispatch(() => session.setDraft(value)),
  });
  const pendingExternalValue = computed(() => projection.value.pending);
  const revision = computed(() => projection.value.revision);
  const dirty = computed(() => projection.value.dirty);
  const hasPendingExternalValue = computed(() => projection.value.hasPending);

  function dispatch(action: () => void): void {
    action();
    projection.value = capture();
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
    commitSavedBaseline: (value, preservePendingExternal) => dispatch(() => session.commitSavedBaseline(value, preservePendingExternal)),
    loadBase: (value) => dispatch(() => session.loadBaseline(value)),
    loadPendingExternal: () => dispatch(() => session.loadPendingExternal()),
    resetDraft: () => dispatch(() => session.resetDraft()),
    setDraft: (value) => dispatch(() => session.setDraft(value)),
  };
}
