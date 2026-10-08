import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useFieldInputs, type FieldInputs } from '@/shared/runtime/field-inputs';

export function useFieldInputActions(inputs: FieldInputs | null = useFieldInputs()) {
  const feedback = useAppFeedback();

  function commitBefore(action: () => void) {
    const pending = inputs?.commit();
    if (!pending) {
      action();
      return;
    }
    const targetKey = inputs!.targetKey.value;
    return pending
      .then((accepted) => {
        if (accepted && targetKey === inputs!.targetKey.value) action();
      })
      .catch((error: unknown) => feedback.error(error));
  }

  function confirmDiscard(action: () => void, dirty: boolean, targetKey: () => string | null) {
    if (!dirty) {
      action();
      return;
    }
    const capturedKey = targetKey();
    feedback.confirmWarning({
      title: '放弃未保存修改并载入外部版本？',
      content: '载入后使用外部版本作为新的编辑基线。',
      actionText: '放弃修改并载入',
      onConfirm: () => {
        if (targetKey() === capturedKey) action();
      },
    });
  }

  return { commitBefore, confirmDiscard };
}
