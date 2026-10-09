import { watch, type Ref } from 'vue';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { destroyCurrentWindow, listenCurrentWindowCloseRequest, currentWindowLabel } from '@/windows/current.window';
import { listenWindowEvent, type UnlistenFn } from '@/windows/tauri.events';
import { WINDOW_EVENTS } from '@/windows/window.events';
import { cancelNativeWindowClose, updateNativeWindowStatus } from '@/services/window.service';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';
import type { WindowCloseIntent } from '@/shared/types';

interface DirtyWindowCloseGuardOptions {
  beforeClose?: () => Promise<boolean>;
  content: string;
  dirty: Readonly<Ref<boolean>>;
  title: string;
}

export function useDirtyWindowCloseGuard(options: DirtyWindowCloseGuardOptions) {
  const feedback = useAppFeedback();
  const commands = useSaveCommandStore();
  let disposed = false;
  let pendingClose: Promise<boolean> | null = null;
  let unlisten: UnlistenFn | null = null;
  let unlistenIntent: UnlistenFn | null = null;
  let stopStatus: (() => void) | null = null;

  async function install(): Promise<void> {
    const nextUnlisten = await listenCurrentWindowCloseRequest(handleCloseRequested);
    if (disposed) {
      nextUnlisten();
      return;
    }
    unlisten?.();
    unlisten = nextUnlisten;
    const intentListener = await listenWindowEvent<WindowCloseIntent>(
      WINDOW_EVENTS.windowCloseIntent,
      async (intent) => {
        if (!intent.labels.includes(currentWindowLabel())) return;
        if (intent.onlyIfClean && (options.dirty.value || commands.hasPendingSave())) {
          await cancelNativeWindowClose(intent.requestId);
          return;
        }
        if (!(await requestClose())) await cancelNativeWindowClose(intent.requestId);
      },
      recordWindowEventHandlerError,
    );
    if (disposed) {
      intentListener();
      return;
    }
    unlistenIntent?.();
    unlistenIntent = intentListener;
    stopStatus?.();
    stopStatus = watch(
      () => [options.dirty.value, commands.hasPendingSave()] as const,
      ([dirty, saving]) => {
        void updateNativeWindowStatus({ dirty, saving }).catch((error) => feedback.error(error, '同步窗口状态失败'));
      },
      { immediate: true, flush: 'sync' },
    );
  }

  function dispose(): void {
    disposed = true;
    unlisten?.();
    unlistenIntent?.();
    stopStatus?.();
    unlisten = null;
    unlistenIntent = null;
    stopStatus = null;
  }

  function handleCloseRequested(event: { preventDefault: () => void }): void {
    if (disposed || (!options.beforeClose && !options.dirty.value && !commands.hasPendingSave())) return;
    event.preventDefault();
    void requestClose();
  }

  function requestClose(): Promise<boolean> {
    if (pendingClose) return pendingClose;
    pendingClose = completeClose().finally(() => {
      pendingClose = null;
    });
    return pendingClose;
  }

  async function completeClose(): Promise<boolean> {
    try {
      const pending = commands.waitForSaves();
      if (pending && !(await pending)) return false;
      if (disposed) return false;
      if (options.dirty.value) {
        const choice = await feedback.choose({
          choices: [{ label: '放弃修改并关闭', value: 'discard', type: 'warning' }],
          content: options.content,
          title: options.title,
        });
        if (choice !== 'discard' || disposed) return false;
      }
      if (options.beforeClose && !(await options.beforeClose())) return false;
      await destroyCurrentWindow();
      return true;
    } catch (error) {
      feedback.error(error, '确认关闭编辑器失败');
      return false;
    }
  }

  return { dispose, install };
}
