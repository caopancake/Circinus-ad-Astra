import {
  computed,
  getCurrentInstance,
  inject,
  nextTick,
  onScopeDispose,
  provide,
  ref,
  shallowReactive,
  type InjectionKey,
  type Ref,
} from 'vue';
import { AppError } from '@/shared/lib/errors';

export interface FieldInput {
  key: string;
  dirty: Readonly<Ref<boolean>>;
  label: string;
  commit: () => string | null;
  focus: () => void | Promise<void>;
  cancel: () => void;
}

export type FieldInputs = ReturnType<typeof createFieldInputs>;
const fieldInputsKey: InjectionKey<FieldInputs> = Symbol('field-inputs');

export function createFieldInputs(targetKey: Readonly<Ref<string | null>> = ref(null)) {
  const fields = shallowReactive(new Set<FieldInput>());
  const finalizers = new Map<() => void, string | undefined>();
  const dirty = computed(() => [...fields].some((field) => field.dirty.value));
  let generation = 0;

  function register(field: FieldInput) {
    fields.add(field);
    return () => fields.delete(field);
  }

  function commit(prefix?: string): Promise<boolean> | undefined {
    const matches = (key: string) => prefix === undefined || key === prefix || key.startsWith(prefix + '/');
    const pending = [...fields].filter((field) => field.dirty.value && matches(field.key));
    const finish = [...finalizers]
      .filter(([, key]) => prefix === undefined || (key !== undefined && matches(key)))
      .sort(([, left], [, right]) => Number(left === undefined) - Number(right === undefined))
      .map(([finalize]) => finalize);
    if (pending.length === 0 && finish.length === 0) return;
    return commitPending(pending, finish);
  }

  async function commitPending(pending: FieldInput[], finish: Array<() => void>) {
    const key = targetKey.value;
    const started = generation;
    for (const field of pending) {
      if (generation !== started || targetKey.value !== key) return false;
      if (!fields.has(field) || !field.dirty.value) continue;
      const error = field.commit();
      if (error !== null) {
        await field.focus();
        if (generation !== started || targetKey.value !== key) return false;
        throw new AppError(`${field.label}：${error}`, { action: 'commit-field-inputs' });
      }
      await nextTick();
    }
    if (generation !== started || targetKey.value !== key) return false;
    for (const finalize of finish) finalize();
    return true;
  }

  function cancel(prefix?: string) {
    if (prefix === undefined) generation++;
    for (const field of fields) {
      if (prefix === undefined || field.key === prefix || field.key.startsWith(`${prefix}/`)) field.cancel();
    }
  }
  function release() {
    cancel();
    fields.clear();
    finalizers.clear();
  }
  function registerFinalizer(finalize: () => void, key?: string) {
    finalizers.set(finalize, key);
    return () => finalizers.delete(finalize);
  }
  function dirtyDescendants(key: string) {
    return [...fields].some((field) => field.key.startsWith(key + '/') && field.dirty.value);
  }
  function captureContext() {
    const captured = generation;
    return () => captured === generation;
  }
  return { targetKey, dirty, dirtyDescendants, register, registerFinalizer, captureContext, commit, cancel, release };
}

export function provideFieldInputs(state = createFieldInputs()) {
  if (getCurrentInstance()) provide(fieldInputsKey, state);
  return state;
}

export function useFieldInputs() {
  return inject(fieldInputsKey, null);
}

export function registerFieldInput(field: FieldInput) {
  const state = useFieldInputs();
  if (state) onScopeDispose(state.register(field));
}
