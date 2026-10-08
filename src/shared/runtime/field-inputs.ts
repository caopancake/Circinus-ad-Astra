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
  const dirty = computed(() => [...fields].some((field) => field.dirty.value));
  let generation = 0;

  function register(field: FieldInput) {
    fields.add(field);
    return () => fields.delete(field);
  }

  function commit(): Promise<boolean> | undefined {
    const pending = [...fields].filter((field) => field.dirty.value);
    if (pending.length === 0) return;
    return commitPending(pending);
  }

  async function commitPending(pending: FieldInput[]) {
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
    return generation === started && targetKey.value === key;
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
  }
  return { targetKey, dirty, register, commit, cancel, release };
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
