import { computed, ref, shallowRef, type Ref } from 'vue';
import { createFieldInputs, provideFieldInputs, type FieldInputs } from '@/shared/runtime/field-inputs';
import { useDraftSession, type DraftSessionOptions } from '@/app/composables/use-draft-session';
import { deepClone } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { withCause } from '@/shared/lib/errors';
import { createQueryReadOwner, isReadInvalidated } from '@/shared/runtime/read-request';
import type { EditContext, FileVersion } from '@/shared/types';

type MaybePromise<T> = T | Promise<T>;
export type SnapshotAcceptance = 'baseline' | 'pending' | 'obsolete';

export interface EditTargetSnapshot<TValue, TTarget = unknown, TMeta = unknown> {
  target: TTarget;
  value: TValue;
  baseVersions: FileVersion[];
  meta: TMeta;
  commitId?: number;
}

export interface EditTargetDraftSessionOptions<TValue, TTarget, TMeta = unknown> extends DraftSessionOptions<TValue> {
  emptyValue: TValue;
  load: (target: TTarget, signal?: AbortSignal) => MaybePromise<EditTargetSnapshot<TValue, TTarget, TMeta>>;
  save?: (target: TTarget, draft: TValue, baseVersions: FileVersion[]) => MaybePromise<EditTargetSnapshot<TValue, TTarget, TMeta> | void>;
  targetKey: (target: TTarget) => string;
  afterSaved?: (snapshot: EditTargetSnapshot<TValue, TTarget, TMeta>) => MaybePromise<void>;
  withSavePreparation?: (
    target: TTarget,
    submit: (prepared: TTarget) => Promise<EditTargetSnapshot<TValue, TTarget, TMeta> | null>,
  ) => Promise<EditTargetSnapshot<TValue, TTarget, TMeta> | null>;
}

export interface EditTargetDraftSession<TValue, TTarget, TMeta = unknown> {
  currentTarget: Ref<TTarget | null>;
  currentTargetKey: Ref<string | null>;
  baselineSnapshot: Readonly<Ref<EditTargetSnapshot<TValue, TTarget, TMeta> | null>>;
  pendingSnapshot: Readonly<Ref<EditTargetSnapshot<TValue, TTarget, TMeta> | null>>;
  savedSnapshot: Readonly<Ref<EditTargetSnapshot<TValue, TTarget, TMeta> | null>>;
  hasPendingSynchronization: Readonly<Ref<boolean>>;
  context: Readonly<Ref<EditContext | null>>;
  dirty: Readonly<Ref<boolean>>;
  draftValue: Ref<TValue>;
  externalUpdateNotice: Readonly<Ref<string>>;
  hasPendingExternalValue: Readonly<Ref<boolean>>;
  pendingExternalValue: Readonly<Ref<TValue | null>>;
  loading: Ref<boolean>;
  ready: Readonly<Ref<boolean>>;
  saving: Ref<boolean>;
  inputs: FieldInputs;
  applyExternalForTarget: (snapshot: EditTargetSnapshot<TValue, TTarget, TMeta>) => SnapshotAcceptance;
  adoptIdentity: (
    expected: TTarget,
    snapshot: EditTargetSnapshot<TValue, TTarget, TMeta>,
    mapDraft: (draft: TValue) => TValue,
    handoff?: 'external' | 'save',
  ) => boolean;
  loadBaseForTarget: (snapshot: EditTargetSnapshot<TValue, TTarget, TMeta>) => void;
  clearTarget: () => void;
  dispose: () => void;
  loadPendingExternal: () => void;
  loadTarget: (target: TTarget) => Promise<EditTargetSnapshot<TValue, TTarget, TMeta> | null>;
  refreshTarget: (target: TTarget) => Promise<EditTargetSnapshot<TValue, TTarget, TMeta> | null>;
  resetDraft: () => void;
  saveDraft: () => Promise<EditTargetSnapshot<TValue, TTarget, TMeta> | null>;
  waitForSave: () => Promise<boolean>;
  setDraft: (value: TValue) => void;
  isTargetCurrent: (target: TTarget) => boolean;
}

export function useEditTargetDraftSession<TValue, TTarget, TMeta = unknown>(
  options: EditTargetDraftSessionOptions<TValue, TTarget, TMeta>,
): EditTargetDraftSession<TValue, TTarget, TMeta> {
  type Snapshot = EditTargetSnapshot<TValue, TTarget, TMeta>;
  const clone = options.clone ?? deepClone;
  const equals = options.equals ?? stableDeepEqual;
  const copy = (snapshot: Snapshot): Snapshot => ({ ...deepClone(snapshot), value: clone(snapshot.value) });
  const session = useDraftSession<Snapshot | null>(null, {
    clone: (snapshot) => (snapshot === null ? null : copy(snapshot)),
    equals: (left, right) => (left === null || right === null ? left === right : equals(left.value, right.value)),
  });
  const currentTarget = shallowRef<TTarget | null>(null) as Ref<TTarget | null>;
  const currentTargetKey = ref<string | null>(null);
  const inputs = provideFieldInputs(createFieldInputs(currentTargetKey));
  const context = shallowRef<EditContext | null>(null);
  const savedSnapshot = shallowRef<Snapshot | null>(null);
  const pendingSynchronization = shallowRef<Snapshot | null>(null);
  const reads = createQueryReadOwner();
  const loading = ref(false);
  const saving = ref(false);
  const baselineSnapshot = computed(() => session.baseValue.value);
  const pendingSnapshot = computed(() => session.pendingExternalValue.value);
  const ready = computed(() => baselineSnapshot.value !== null && sameTarget(baselineSnapshot.value.target));
  let pendingDraftBeforeLoad: TValue | null = null;
  const dirty = computed(() => session.dirty.value || inputs.dirty.value || pendingDraftBeforeLoad !== null);
  let disposed = false;
  let lifetime = 0;
  let baselineGeneration = 0;
  let lastCommitId = -1;
  let pendingSave: Promise<Snapshot | null> | null = null;
  let refreshQueued = false;
  let activeReadIdentity: object | null = null;

  function revokeReads() {
    reads.revoke('consumer');
    activeReadIdentity = null;
    loading.value = false;
  }

  function publishContext(handoff: EditContext['handoff']) {
    context.value = { targetKey: currentTargetKey.value!, baselineGeneration: ++baselineGeneration, handoff };
  }
  function sameTarget(target: TTarget) {
    return currentTargetKey.value === options.targetKey(target);
  }
  function setDraft(value: TValue) {
    const baseline = baselineSnapshot.value;
    if (!baseline) {
      pendingDraftBeforeLoad = clone(value);
      return;
    }
    pendingDraftBeforeLoad = null;
    revokeReads();
    session.setDraft({ ...baseline, value: clone(value) });
  }
  const draftValue = computed({
    get: () => session.draftValue.value?.value ?? options.emptyValue,
    set: setDraft,
  });

  function loadBaseForTarget(snapshot: Snapshot, revoke = true) {
    if (!sameTarget(snapshot.target)) lastCommitId = -1;
    lastCommitId = Math.max(lastCommitId, snapshot.commitId ?? -1);
    if (revoke) revokeReads();
    currentTarget.value = snapshot.target;
    currentTargetKey.value = options.targetKey(snapshot.target);
    session.loadBase(copy(snapshot));
    if (pendingDraftBeforeLoad !== null) {
      session.setDraft({ ...copy(snapshot), value: clone(pendingDraftBeforeLoad) });
      pendingDraftBeforeLoad = null;
    }
    inputs.cancel();
    publishContext('load');
  }

  function adoptIdentity(
    expected: TTarget,
    snapshot: Snapshot,
    mapDraft: (draft: TValue) => TValue,
    handoff: 'external' | 'save' = 'external',
  ): boolean {
    if (disposed || !sameTarget(expected)) return false;
    const draft = mapDraft(clone(draftValue.value));
    revokeReads();
    lastCommitId = Math.max(lastCommitId, snapshot.commitId ?? -1);
    currentTarget.value = snapshot.target;
    currentTargetKey.value = options.targetKey(snapshot.target);
    session.commitSavedBaseline(copy(snapshot));
    session.setDraft({ ...copy(snapshot), value: draft });
    publishContext(handoff);
    return true;
  }

  function applyExternalForTarget(snapshot: Snapshot, fromSaveRefresh = false): SnapshotAcceptance {
    if (disposed || !sameTarget(snapshot.target)) return 'obsolete';
    if (saving.value && !fromSaveRefresh) {
      refreshQueued = true;
      return 'obsolete';
    }
    const previousCommit = Math.max(
      lastCommitId,
      baselineSnapshot.value?.commitId ?? -1,
      pendingSnapshot.value?.commitId ?? -1,
      savedSnapshot.value && options.targetKey(savedSnapshot.value.target) === currentTargetKey.value
        ? (savedSnapshot.value.commitId ?? -1)
        : -1,
    );
    if (snapshot.commitId !== undefined && snapshot.commitId <= previousCommit) return 'obsolete';
    lastCommitId = Math.max(lastCommitId, snapshot.commitId ?? -1);
    const baseline = baselineSnapshot.value;
    const sameBaseline =
      baseline !== null && equals(baseline.value, snapshot.value) && stableDeepEqual(baseline.baseVersions, snapshot.baseVersions);
    revokeReads();
    if (sameBaseline) {
      session.commitSavedBaseline(copy(snapshot), true);
      return 'baseline';
    }
    if (dirty.value) {
      session.applyExternal(copy(snapshot), true);
      return 'pending';
    }
    session.loadBase(copy(snapshot));
    inputs.cancel();
    publishContext('external');
    return 'baseline';
  }

  async function readTarget(target: TTarget, mode: 'load' | 'external', fromSaveRefresh = false): Promise<Snapshot | null> {
    const key = options.targetKey(target);
    if (mode === 'load' && key !== currentTargetKey.value) {
      lastCommitId = -1;
      revokeReads();
      session.clear(null);
      pendingDraftBeforeLoad = null;
      inputs.cancel();
      currentTarget.value = target;
      currentTargetKey.value = key;
    }
    const identity = { targetKey: key, lifetime };
    activeReadIdentity = identity;
    loading.value = true;
    let acceptedSynchronously = false;
    try {
      const snapshot = await reads.read(
        'target',
        identity,
        (signal) => options.load(target, signal),
        (readySnapshot) => {
          if (!disposed && mode === 'load' && key === currentTargetKey.value) {
            acceptedSynchronously = true;
            loadBaseForTarget(readySnapshot, false);
          }
        },
      );
      if (disposed || key !== currentTargetKey.value) return null;
      if (acceptedSynchronously) return copy(snapshot);
      if (mode === 'load') loadBaseForTarget(snapshot);
      else if (applyExternalForTarget(snapshot, fromSaveRefresh) !== 'baseline') return null;
      return copy(snapshot);
    } catch (error) {
      if (isReadInvalidated(error)) return null;
      if (disposed || key !== currentTargetKey.value) return null;
      throw error;
    } finally {
      if (activeReadIdentity === identity) {
        activeReadIdentity = null;
        loading.value = false;
      }
    }
  }
  function loadTarget(target: TTarget) {
    return readTarget(target, 'load');
  }
  function refreshTarget(target: TTarget): Promise<Snapshot | null> {
    if (saving.value) {
      refreshQueued = true;
      return pendingSave!.then(
        () => baselineSnapshot.value,
        () => null,
      );
    }
    return readTarget(target, 'external');
  }

  function saveDraft(): Promise<Snapshot | null> {
    if (pendingSave) return pendingSave;
    if (!options.save || !ready.value || disposed) return Promise.resolve(null);
    saving.value = true;
    const life = lifetime;
    const execute = (prepared: TTarget) => submit(prepared, options.targetKey(prepared), life);
    const operation = (async () => {
      if (pendingSynchronization.value) {
        await synchronizeSaved(pendingSynchronization.value, life);
        if (!dirty.value || disposed || life !== lifetime) return baselineSnapshot.value;
      }
      const latestTarget = deepClone(currentTarget.value!);
      return options.withSavePreparation
        ? options.withSavePreparation(latestTarget, execute)
        : submit(latestTarget, currentTargetKey.value, life);
    })();
    const task = operation
      .catch((error: unknown) => {
        if (isReadInvalidated(error)) return null;
        throw error;
      })
      .finally(() => {
        saving.value = false;
        pendingSave = null;
        refreshQueued = false;
      });
    pendingSave = task;
    return task;
  }

  async function submit(target: TTarget, key: string | null, life: number): Promise<Snapshot | null> {
    const committed = inputs.commit();
    if (committed && !(await committed)) return null;
    if (disposed || life !== lifetime || key !== currentTargetKey.value) return null;
    const submitted = clone(draftValue.value);
    const versions = deepClone(baselineSnapshot.value!.baseVersions);
    revokeReads();
    const result = await options.save!(target, submitted, versions);
    if (!result) return null;
    savedSnapshot.value = copy(result);
    revokeReads();
    if (!disposed && life === lifetime && key === currentTargetKey.value) {
      lastCommitId = Math.max(lastCommitId, result.commitId ?? -1);
      const preserve = !equals(draftValue.value, submitted) || inputs.dirty.value;
      if (preserve) session.commitSavedBaseline(copy(result));
      else session.commitSaved(copy(result));
      currentTarget.value = result.target;
      currentTargetKey.value = options.targetKey(result.target);
      publishContext('save');
    }
    pendingSynchronization.value = copy(result);
    return synchronizeSaved(result, life);
  }

  async function synchronizeSaved(result: Snapshot, life: number): Promise<Snapshot> {
    try {
      await options.afterSaved?.(copy(result));
      pendingSynchronization.value = null;
      if (refreshQueued && !disposed && life === lifetime) {
        refreshQueued = false;
        await readTarget(currentTarget.value!, 'external', true);
      }
    } catch (error) {
      throw withCause('已写盘，后续同步失败', error, 'sync-saved-target');
    }
    return copy(result);
  }

  function retrySynchronization(): Promise<Snapshot | null> {
    if (pendingSave) return pendingSave;
    if (!pendingSynchronization.value) return Promise.resolve(baselineSnapshot.value);
    saving.value = true;
    pendingSave = synchronizeSaved(pendingSynchronization.value, lifetime).finally(() => {
      saving.value = false;
      pendingSave = null;
    });
    return pendingSave;
  }

  function loadPendingExternal() {
    const snapshot = pendingSnapshot.value;
    if (!snapshot) return;
    revokeReads();
    session.loadPendingExternal();
    currentTarget.value = snapshot.target;
    currentTargetKey.value = options.targetKey(snapshot.target);
    inputs.cancel();
    publishContext('external');
  }
  function resetDraft() {
    revokeReads();
    pendingDraftBeforeLoad = null;
    session.resetDraft();
    inputs.cancel();
    publishContext('reset');
  }
  function clearTarget() {
    pendingSynchronization.value = null;
    pendingDraftBeforeLoad = null;
    lastCommitId = -1;
    lifetime++;
    revokeReads();
    currentTarget.value = null;
    currentTargetKey.value = null;
    context.value = null;
    loading.value = false;
    session.clear(null);
    inputs.cancel();
  }
  function dispose() {
    disposed = true;
    clearTarget();
    inputs.release();
  }
  return {
    currentTarget,
    currentTargetKey,
    baselineSnapshot,
    pendingSnapshot,
    savedSnapshot,
    hasPendingSynchronization: computed(() => pendingSynchronization.value !== null),
    context,
    dirty,
    draftValue,
    loading,
    ready,
    saving,
    inputs,
    hasPendingExternalValue: computed(() => pendingSnapshot.value !== null),
    pendingExternalValue: computed(() => pendingSnapshot.value?.value ?? null),
    externalUpdateNotice: computed(() =>
      pendingSnapshot.value ? (options.externalNotice ?? '外部版本已更新，当前未保存草稿已保留。') : '',
    ),
    applyExternalForTarget,
    adoptIdentity,
    loadBaseForTarget,
    clearTarget,
    dispose,
    loadPendingExternal,
    loadTarget,
    refreshTarget,
    resetDraft,
    saveDraft,
    setDraft,
    isTargetCurrent: sameTarget,
    waitForSave: () =>
      pendingSave || pendingSynchronization.value
        ? retrySynchronization().then(
            (snapshot) => snapshot !== null,
            () => false,
          )
        : Promise.resolve(true),
  };
}
