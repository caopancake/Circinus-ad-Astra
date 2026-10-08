import { inject, onScopeDispose, provide, ref, watch, type InjectionKey, type Ref } from 'vue';
import { useSettingsStore } from '@/stores/settings.store';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useFieldInputs, type FieldInputs } from '@/shared/runtime/field-inputs';
import type { EditMode } from '@/shared/types';

const inputEditModeKey: InjectionKey<{ inputs: FieldInputs | null; mode: Readonly<Ref<EditMode>> }> = Symbol('input-edit-mode');

export function useInputEditMode(inputs: FieldInputs | null = useFieldInputs()) {
  const inherited = inject(inputEditModeKey, null);
  if (inherited?.inputs === inputs) return inherited.mode;
  const settings = useSettingsStore();
  const feedback = useAppFeedback();
  const mode = ref(settings.editMode);
  let disposed = false;
  let prompting = false;
  provide(inputEditModeKey, { inputs, mode });
  watch(
    () => inputs?.targetKey.value,
    () => {
      if (!inputs?.dirty.value) mode.value = settings.editMode;
    },
  );
  watch(
    () => settings.editMode,
    async (nextMode) => {
      if (!inputs?.dirty.value) {
        mode.value = nextMode;
        return;
      }
      if (prompting) return;
      prompting = true;
      const targetKey = inputs.targetKey.value;
      try {
        const choice = await feedback.choose({
          title: '放弃未提交输入并切换编辑模式？',
          content: '当前控件有未提交输入，确认后采用新的编辑模式。',
          choices: [{ label: '放弃输入并切换', value: 'discard', type: 'warning' }],
        });
        if (disposed || targetKey !== inputs.targetKey.value || choice !== 'discard') return;
        inputs.cancel();
        mode.value = settings.editMode;
      } catch (error) {
        feedback.error(error, '切换编辑模式失败');
      } finally {
        prompting = false;
      }
    },
  );
  onScopeDispose(() => {
    disposed = true;
  });
  return mode;
}
