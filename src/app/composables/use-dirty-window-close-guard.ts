import type { Ref } from 'vue';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import type { UnlistenFn } from '@/windows/tauri.events';
import { destroyCurrentWindow, listenCurrentWindowCloseRequest } from '@/windows/current.window';

interface DirtyWindowCloseGuardOptions {
  content: string;
  dirty: Readonly<Ref<boolean>>;
  title: string;
}

export function useDirtyWindowCloseGuard(options: DirtyWindowCloseGuardOptions) {
  const feedback = useAppFeedback();
  const commands = useSaveCommandStore();
  let disposed = false;
  let prompting = false;
  let unlisten: UnlistenFn | null = null;

  async function install(): Promise<void> {
    const nextUnlisten = await listenCurrentWindowCloseRequest(handleCloseRequested);
    if (disposed) {
      nextUnlisten();
      return;
    }
    unlisten?.();
    unlisten = nextUnlisten;
  }

  function dispose(): void {
    disposed = true;
    unlisten?.();
    unlisten = null;
  }

  async function handleCloseRequested(event: { preventDefault: () => void }): Promise<void> {
    if (disposed || (!options.dirty.value && !commands.hasPendingSave())) return;
    event.preventDefault();
    if (prompting) {
      return;
    }
    prompting = true;
    try {
      const pending = commands.waitForSaves();
      if (pending && !(await pending)) return;
      if (disposed) return;
      if (!options.dirty.value) {
        await destroyCurrentWindow();
        return;
      }
      const choice = await feedback.choose({
        choices: [{ label: '放弃修改并关闭', value: 'discard', type: 'warning' }],
        content: options.content,
        title: options.title,
      });
      if (choice !== 'discard' || disposed) return;
      await destroyCurrentWindow();
    } catch (error) {
      feedback.error(error, '确认关闭编辑器失败');
    } finally {
      prompting = false;
    }
  }

  return { dispose, install };
}
