import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useSaveCommandStore } from '@/stores/save-command.store';

interface DraftTransitionConfirmationOptions {
  action: () => void | Promise<void>;
  content: string;
  title: string;
}

export function useDraftTransitionConfirmation() {
  const feedback = useAppFeedback();
  const draftSessions = useDraftSessionsStore();
  const commands = useSaveCommandStore();

  function confirmDraftTransition(modRoot: string | null, options: DraftTransitionConfirmationOptions): void {
    const sequence = commands.beginTransition();
    const pending = commands.waitForSaves(modRoot);
    if (pending) {
      void pending.then((saved) => {
        if (saved && commands.isTransitionCurrent(sequence)) confirmIdleTransition(modRoot, options, sequence);
      });
      return;
    }
    confirmIdleTransition(modRoot, options, sequence);
  }

  function confirmIdleTransition(modRoot: string | null, options: DraftTransitionConfirmationOptions, sequence: number): void {
    if (!modRoot || !draftSessions.hasDirtyDraftForMod(modRoot)) {
      void options.action();
      return;
    }
    feedback.confirmWarning({
      title: options.title,
      content: options.content,
      actionText: '放弃修改并继续',
      onConfirm: () => {
        if (commands.isTransitionCurrent(sequence)) return options.action();
      },
    });
  }

  return { confirmDraftTransition };
}
