import { computed, nextTick, ref, watch } from 'vue';
import { registerFieldInput } from '@/shared/runtime/field-inputs';

export type InputConversion<T> = { kind: 'value'; value: T } | { kind: 'remove' } | { kind: 'error'; message: string };

export function useRawFieldInput<T>(options: {
  key: string;
  label: string;
  text: () => string;
  convert: (raw: string) => InputConversion<T>;
  apply: (converted: Exclude<InputConversion<T>, { kind: 'error' }>) => void;
  focus: () => void | Promise<void>;
  canonicalize?: boolean;
  onCancel?: () => void;
}) {
  const raw = ref(options.text());
  const baseline = ref(raw.value);
  const invalid = ref(false);
  const dirty = computed(() => raw.value !== baseline.value);

  function update(text: string) {
    raw.value = text;
    invalid.value = false;
  }
  function synchronize() {
    baseline.value = options.text();
    raw.value = baseline.value;
    invalid.value = false;
  }
  function cancel() {
    synchronize();
    options.onCancel?.();
  }
  function commit(): string | null {
    if (!dirty.value) return null;
    const converted = options.convert(raw.value);
    if (converted.kind === 'error') {
      invalid.value = true;
      return converted.message;
    }
    options.apply(converted);
    baseline.value = raw.value;
    invalid.value = false;
    if (options.canonicalize)
      void nextTick(() => {
        if (!dirty.value) synchronize();
      });
    return null;
  }
  watch(options.text, () => {
    if (!dirty.value) synchronize();
  });
  registerFieldInput({ key: options.key, label: options.label, dirty, commit, focus: options.focus, cancel });
  return { raw, dirty, invalid, update, commit, cancel };
}
