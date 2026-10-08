import { computed, ref, shallowRef, type Ref } from 'vue';
import { createFieldInputs, provideFieldInputs, type FieldInputs } from '@/shared/runtime/field-inputs';
import { useDraftSession, type DraftSessionOptions } from '@/app/composables/use-draft-session';
import { deepClone } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { withCause } from '@/shared/lib/errors';
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
  load: (target: TTarget) => MaybePromise<EditTargetSnapshot<TValue, TTarget, TMeta>>;
  save?: (target: TTarget, draft: TValue, baseVersions: FileVersion[]) => MaybePromise<EditTargetSnapshot<TValue, TTarget, TMeta> | void>;
  targetKey: (target: TTarget) => string;
  afterSaved?: (snapshot: EditTargetSnapshot<TValue, TTarget, TMeta>) => MaybePromise<void>;
}

export interface EditTargetDraftSession<TValue, TTarget, TMeta = unknown> {
  currentTarget: Ref<TTarget | null>;
  currentTargetKey: Ref<string | null>;
  baselineSnapshot: Readonly<Ref<EditTargetSnapshot<TValue, TTarget, TMeta> | null>>;
  pendingSnapshot: Readonly<Ref<EditTargetSnapshot<TValue, TTarget, TMeta> | null>>;
  savedSnapshot: Readonly<Ref<EditTargetSnapshot<TValue, TTarget, TMeta> | null>>;
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
  const loading = ref(false);
  const saving = ref(false);
  const baselineSnapshot = computed(() => session.baseValue.value);
  const pendingSnapshot = computed(() => session.pendingExternalValue.value);
  const ready = computed(() => baselineSnapshot.value !== null && sameTarget(baselineSnapshot.value.target));
  const dirty = computed(() => session.dirty.value || inputs.dirty.value);
  let disposed = false;
  let lifetime = 0;
  let epoch = 0;
  let readSequence = 0;
  let baselineGeneration = 0;
  let lastCommitId = -1;
  let pendingSave: Promise<Snapshot | null> | null = null;
  let refreshQueued = false;

  function revokeReads() {
    epoch++;
    readSequence++;
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
    if (!baseline) return;
    revokeReads();
    session.setDraft({ ...baseline, value: clone(value) });
  }
  const draftValue = computed({
    get: () => session.draftValue.value?.value ?? options.emptyValue,
    set: setDraft,
  });

  function loadBaseForTarget(snapshot: Snapshot) {
    if (!sameTarget(snapshot.target)) lastCommitId = -1;
    lastCommitId = Math.max(lastCommitId, snapshot.commitId ?? -1);
    revokeReads();
    currentTarget.value = snapshot.target;
    currentTargetKey.value = options.targetKey(snapshot.target);
    session.loadBase(copy(snapshot));
    inputs.cancel();
    publishContext('load');
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
      inputs.cancel();
      currentTarget.value = target;
      currentTargetKey.value = key;
    }
    const ticket = { lifetime, epoch, sequence: ++readSequence, key };
    loading.value = true;
    try {
      const snapshot = await options.load(target);
      if (
        disposed ||
        ticket.lifetime !== lifetime ||
        ticket.epoch !== epoch ||
        ticket.sequence !== readSequence ||
        key !== currentTargetKey.value
      )
        return null;
      if (mode === 'load') loadBaseForTarget(snapshot);
      else if (applyExternalForTarget(snapshot, fromSaveRefresh) !== 'baseline') return null;
      return copy(snapshot);
    } catch (error) {
      if (
        disposed ||
        ticket.lifetime !== lifetime ||
        ticket.epoch !== epoch ||
        ticket.sequence !== readSequence ||
        key !== currentTargetKey.value
      )
        return null;
      throw error;
    } finally {
      if (ticket.lifetime === lifetime && ticket.sequence === readSequence) loading.value = false;
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
    const target = deepClone(currentTarget.value!);
    const key = currentTargetKey.value;
    const life = lifetime;
    const task = submit(target, key, life).finally(() => {
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
    try {
      await options.afterSaved?.(copy(result));
      if (refreshQueued && !disposed && life === lifetime) {
        refreshQueued = false;
        await readTarget(currentTarget.value!, 'external', true);
      }
    } catch (error) {
      throw withCause('已写盘，后续同步失败', error, 'sync-saved-target');
    }
    return copy(result);
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
    session.resetDraft();
    inputs.cancel();
    publishContext('reset');
  }
  function clearTarget() {
    lastCommitId = -1;
    lifetime++;
    revokeReads();
    readSequence++;
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
      pendingSave
        ? pendingSave.then(
            (snapshot) => snapshot !== null,
            () => false,
          )
        : Promise.resolve(true),
  };
}
