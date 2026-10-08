import { computed, ref, type Ref } from 'vue';
import { provideFieldInputs } from '@/shared/runtime/field-inputs';
import { useDraftSession, type DraftSession, type DraftSessionOptions } from '@/app/composables/use-draft-session';
import { deepClone } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';

type MaybePromise<T> = T | Promise<T>;

export interface EditTargetSnapshot<TValue, TMeta = unknown> {
  baseVersions?: import('@/shared/types').FileVersion[];
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
  save?: (
    target: TTarget,
    draft: TValue,
    baseVersions: import('@/shared/types').FileVersion[],
  ) => MaybePromise<EditTargetSnapshot<TValue, TSaveMeta> | void>;
  targetKey: (target: TTarget) => string;
  onLoaded?: (target: TTarget, value: TValue, meta: TLoadMeta | undefined) => void;
  onSaved?: (target: TTarget, value: TValue, meta: TSaveMeta | undefined) => void;
  savedTarget?: (target: TTarget, snapshot: EditTargetSnapshot<TValue, TSaveMeta>) => TTarget;
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
  applyExternalForTarget: (target: TTarget, value: TValue, versions?: import('@/shared/types').FileVersion[]) => void;
  clearTarget: () => void;
  dispose: () => void;
  loadBaseForTarget: (target: TTarget, value: TValue, versions?: import('@/shared/types').FileVersion[]) => void;
  loadPendingExternal: () => void;
  loadTarget: (target: TTarget) => Promise<EditTargetSnapshot<TValue, TLoadMeta> | null>;
  refreshTarget: (target: TTarget) => Promise<EditTargetSnapshot<TValue, TLoadMeta> | null>;
  resetDraft: () => void;
  saveDraft: () => Promise<EditTargetSnapshot<TValue, TSaveMeta> | null>;
  setDraft: (value: TValue) => void;
  isTargetCurrent: (target: TTarget) => boolean;
}

export function useEditTargetDraftSession<TValue, TTarget, TLoadMeta = unknown, TSaveMeta = unknown>(
  options: EditTargetDraftSessionOptions<TValue, TTarget, TLoadMeta, TSaveMeta>,
): EditTargetDraftSession<TValue, TTarget, TLoadMeta, TSaveMeta> {
  const draftSession = useDraftSession(options.emptyValue, options);
  const fieldInputs = provideFieldInputs();
  const clone = options.clone ?? deepClone;
  const equals = options.equals ?? stableDeepEqual;
  const currentTarget = ref<TTarget | null>(null) as Ref<TTarget | null>;
  const currentTargetKey = ref<string | null>(null);
  const loading = ref(false);
  const saving = ref(false);
  let disposed = false;
  let loadRequestId = 0;
  let saveRequestId = 0;
  let baseVersions: import('@/shared/types').FileVersion[] = [];
  let pendingVersions: import('@/shared/types').FileVersion[] | null = null;

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
      if (mode === 'base') {
        baseVersions = snapshot.baseVersions ?? [];
        pendingVersions = null;
        draftSession.loadBase(snapshot.value);
        fieldInputs.reset();
      } else {
        if (draftSession.dirty.value || fieldInputs.dirty.value) pendingVersions = snapshot.baseVersions ?? [];
        else baseVersions = snapshot.baseVersions ?? [];
        draftSession.applyExternal(snapshot.value, fieldInputs.dirty.value);
      }
      options.onLoaded?.(target, draftSession.draftValue.value, snapshot.meta);
      return snapshot;
    } finally {
      if (isCurrentLoad(requestId, key)) loading.value = false;
    }
  }

  async function saveDraft(): Promise<EditTargetSnapshot<TValue, TSaveMeta> | null> {
    if (!options.save || !currentTarget.value || !currentTargetKey.value) return null;
    if (!sameTarget(currentTarget.value)) return null;
    const requestId = ++saveRequestId;
    const target = currentTarget.value;
    const key = currentTargetKey.value;
    saving.value = true;
    try {
      const fieldCommit = fieldInputs.commit();
      if (fieldCommit) await fieldCommit;
      if (!isCurrentSave(requestId, key)) return null;
      const submittedDraft = clone(draftSession.draftValue.value);
      const result = await options.save(target, submittedDraft, deepClone(baseVersions));
      if (!isCurrentSave(requestId, key)) return null;
      if (!result) return null;
      if (result.baseVersions) baseVersions = result.baseVersions;
      pendingVersions = null;
      if (equals(draftSession.draftValue.value, submittedDraft)) draftSession.commitSaved(result.value);
      else draftSession.commitSavedBaseline(result.value);
      if (options.savedTarget) {
        currentTarget.value = options.savedTarget(target, result);
        currentTargetKey.value = options.targetKey(currentTarget.value);
      }
      options.onSaved?.(target, clone(result.value), result.meta);
      return result;
    } finally {
      if (!disposed && requestId === saveRequestId) saving.value = false;
    }
  }

  function applyExternalForTarget(target: TTarget, value: TValue, versions?: import('@/shared/types').FileVersion[]): void {
    if (!sameTarget(target)) return;
    if (versions) {
      if (draftSession.dirty.value || fieldInputs.dirty.value) pendingVersions = versions;
      else baseVersions = versions;
    }
    draftSession.applyExternal(value, fieldInputs.dirty.value);
  }

  function loadBaseForTarget(target: TTarget, value: TValue, versions?: import('@/shared/types').FileVersion[]): void {
    if (versions) baseVersions = versions;
    if (!sameTarget(target)) {
      currentTarget.value = target;
      currentTargetKey.value = options.targetKey(target);
    }
    draftSession.loadBase(value);
  }

  function clearTarget(): void {
    fieldInputs.reset();
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
    dirty: computed(() => draftSession.dirty.value || fieldInputs.dirty.value),
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
    loadPendingExternal: () => {
      draftSession.loadPendingExternal();
      if (pendingVersions) baseVersions = pendingVersions;
      pendingVersions = null;
      fieldInputs.reset();
    },
    loadTarget,
    refreshTarget,
    resetDraft: () => {
      draftSession.resetDraft();
      fieldInputs.reset();
    },
    saveDraft,
    setDraft: draftSession.setDraft,
    isTargetCurrent: sameTarget,
  };
}
