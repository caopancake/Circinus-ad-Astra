import { computed, getCurrentInstance, inject, nextTick, onScopeDispose, provide, shallowReactive, type InjectionKey, type Ref } from 'vue';
import { AppError } from '@/shared/lib/errors';

interface FieldInput {
  dirty: Ref<boolean>;
  label: string;
  commit: () => boolean;
  focus: () => void;
  reset: () => void;
}

const fieldInputsKey: InjectionKey<ReturnType<typeof createFieldInputs>> = Symbol('field-inputs');

function createFieldInputs() {
  const fields = shallowReactive(new Set<FieldInput>());
  const dirty = computed(() => [...fields].some((field) => field.dirty.value));

  function register(field: FieldInput) {
    fields.add(field);
    return () => fields.delete(field);
  }

  function commit(): Promise<void> | undefined {
    const pending = [...fields].filter((field) => field.dirty.value);
    if (pending.length === 0) return;
    return commitPending(pending);
  }

  async function commitPending(pending: FieldInput[]) {
    for (const field of pending) {
      if (field.commit()) {
        await nextTick();
        continue;
      }
      field.focus();
      throw new AppError(`${field.label} JSON 输入未完成，请修正后保存`, { action: 'commit-field-inputs' });
    }
  }

  function reset() {
    for (const field of fields) field.reset();
  }
  return { dirty, register, commit, reset };
}

export function provideFieldInputs() {
  const state = createFieldInputs();
  if (getCurrentInstance()) provide(fieldInputsKey, state);
  return state;
}

export function registerFieldInput(field: FieldInput) {
  const state = inject(fieldInputsKey, null);
  if (state) onScopeDispose(state.register(field));
}
