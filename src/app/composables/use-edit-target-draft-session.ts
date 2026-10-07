import { ref, type Ref } from 'vue';
import { useDraftSession, type DraftSession, type DraftSessionOptions } from '@/app/composables/use-draft-session';
import { deepClone } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';

type MaybePromise<T> = T | Promise<T>;

export interface EditTargetSnapshot<TValue, TMeta = unknown> {
  meta?: TMeta;
  value: TValue;
}

export interface EditTargetDraftSessionOptions<
  TValue,
  TTarget,
  TLoadMeta = unknown,
  TSaveMeta = unknown,
> extends DraftSessionOptions<TValue> {
  emptyValue: TValue;
  load: (target: TTarget) => MaybePromise<EditTargetSnapshot<TValue, TLoadMeta>>;
  save?: (target: TTarget, draft: TValue) => MaybePromise<EditTargetSnapshot<TValue, TSaveMeta> | void>;
  targetKey: (target: TTarget) => string;
  onLoaded?: (target: TTarget, value: TValue, meta: TLoadMeta | undefined) => void;
  onSaved?: (target: TTarget, value: TValue, meta: TSaveMeta | undefined) => void;
}

export interface EditTargetDraftSession<TValue, TTarget, TLoadMeta = unknown, TSaveMeta = unknown> {
  currentTarget: Ref<TTarget | null>;
  currentTargetKey: Ref<string | null>;
  dirty: DraftSession<TValue>['dirty'];
  draftValue: DraftSession<TValue>['draftValue'];
  externalUpdateNotice: DraftSession<TValue>['externalUpdateNotice'];
  hasPendingExternalValue: DraftSession<TValue>['hasPendingExternalValue'];
  loading: Ref<boolean>;
  pendingExternalValue: DraftSession<TValue>['pendingExternalValue'];
  revision: DraftSession<TValue>['revision'];
  saving: Ref<boolean>;
  applyExternalForTarget: (target: TTarget, value: TValue) => void;
  clearTarget: () => void;
  dispose: () => void;
  loadBaseForTarget: (target: TTarget, value: TValue) => void;
  loadPendingExternal: () => void;
  loadTarget: (target: TTarget) => Promise<EditTargetSnapshot<TValue, TLoadMeta> | null>;
  refreshTarget: (target: TTarget) => Promise<EditTargetSnapshot<TValue, TLoadMeta> | null>;
  resetDraft: () => void;
  saveDraft: () => Promise<EditTargetSnapshot<TValue, TSaveMeta> | null>;
  setDraft: (value: TValue) => void;
}

export function useEditTargetDraftSession<TValue, TTarget, TLoadMeta = unknown, TSaveMeta = unknown>(
  options: EditTargetDraftSessionOptions<TValue, TTarget, TLoadMeta, TSaveMeta>,
): EditTargetDraftSession<TValue, TTarget, TLoadMeta, TSaveMeta> {
  const draftSession = useDraftSession(options.emptyValue, options);
  const clone = options.clone ?? deepClone;
  const equals = options.equals ?? stableDeepEqual;
  const currentTarget = ref<TTarget | null>(null) as Ref<TTarget | null>;
  const currentTargetKey = ref<string | null>(null);
  const loading = ref(false);
  const saving = ref(false);
  let disposed = false;
  let loadRequestId = 0;
  let saveRequestId = 0;

  async function loadTarget(target: TTarget): Promise<EditTargetSnapshot<TValue, TLoadMeta> | null> {
    return loadTargetSnapshot(target, 'base');
  }

  async function refreshTarget(target: TTarget): Promise<EditTargetSnapshot<TValue, TLoadMeta> | null> {
    return loadTargetSnapshot(target, 'external');
  }

  async function loadTargetSnapshot(target: TTarget, mode: 'base' | 'external'): Promise<EditTargetSnapshot<TValue, TLoadMeta> | null> {
    const requestId = ++loadRequestId;
    const key = options.targetKey(target);
    currentTarget.value = target;
    currentTargetKey.value = key;
    loading.value = true;
    try {
      const snapshot = await options.load(target);
      if (!isCurrentLoad(requestId, key)) return null;
      if (mode === 'base') draftSession.loadBase(snapshot.value);
      else draftSession.applyExternal(snapshot.value);
      options.onLoaded?.(target, draftSession.draftValue.value, snapshot.meta);
      return snapshot;
    } finally {
      if (isCurrentLoad(requestId, key)) loading.value = false;
    }
  }

  async function saveDraft(): Promise<EditTargetSnapshot<TValue, TSaveMeta> | null> {
    if (!options.save || !currentTarget.value || !currentTargetKey.value) return null;
    const requestId = ++saveRequestId;
    const target = currentTarget.value;
    const key = currentTargetKey.value;
    const submittedDraft = clone(draftSession.draftValue.value);
    saving.value = true;
    try {
      const result = await options.save(target, submittedDraft);
      if (!isCurrentSave(requestId, key)) return null;
      if (!result) return null;
      if (equals(draftSession.draftValue.value, submittedDraft)) draftSession.commitSaved(result.value);
      else draftSession.commitSavedBaseline(result.value);
      options.onSaved?.(target, clone(result.value), result.meta);
      return result;
    } finally {
      if (isCurrentSave(requestId, key)) saving.value = false;
    }
  }

  function applyExternalForTarget(target: TTarget, value: TValue): void {
    if (!sameTarget(target)) return;
    draftSession.applyExternal(value);
  }

  function loadBaseForTarget(target: TTarget, value: TValue): void {
    if (!sameTarget(target)) {
      currentTarget.value = target;
      currentTargetKey.value = options.targetKey(target);
    }
    draftSession.loadBase(value);
  }

  function clearTarget(): void {
    loadRequestId++;
    saveRequestId++;
    currentTarget.value = null;
    currentTargetKey.value = null;
    loading.value = false;
    saving.value = false;
    draftSession.clear(options.emptyValue);
  }

  function dispose(): void {
    disposed = true;
    loadRequestId++;
    saveRequestId++;
  }

  function sameTarget(target: TTarget): boolean {
    return currentTargetKey.value === options.targetKey(target);
  }

  function isCurrentLoad(requestId: number, key: string): boolean {
    return !disposed && requestId === loadRequestId && currentTargetKey.value === key;
  }

  function isCurrentSave(requestId: number, key: string): boolean {
    return !disposed && requestId === saveRequestId && currentTargetKey.value === key;
  }

  return {
    currentTarget,
    currentTargetKey,
    dirty: draftSession.dirty,
    draftValue: draftSession.draftValue,
    externalUpdateNotice: draftSession.externalUpdateNotice,
    hasPendingExternalValue: draftSession.hasPendingExternalValue,
    loading,
    pendingExternalValue: draftSession.pendingExternalValue,
    revision: draftSession.revision,
    saving,
    applyExternalForTarget,
    clearTarget,
    dispose,
    loadBaseForTarget,
    loadPendingExternal: draftSession.loadPendingExternal,
    loadTarget,
    refreshTarget,
    resetDraft: draftSession.resetDraft,
    saveDraft,
    setDraft: draftSession.setDraft,
  };
}
