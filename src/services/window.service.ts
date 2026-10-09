import { invokeCommand } from '@/shared/runtime/command.runtime';
import { withCause } from '@/shared/lib/errors';
import type { ManagedWindowOpened, ManagedWindowStatus, NativeWindowRequest, WindowIdentity } from '@/shared/types';

export async function openNativeManagedWindow(request: NativeWindowRequest) {
  try {
    return await invokeCommand<ManagedWindowOpened>('open_managed_window', { payload: request });
  } catch (error) {
    throw withCause(`打开窗口「${request.title}」失败`, error, 'open-managed-window');
  }
}
export function updateNativeWindowStatus(status: ManagedWindowStatus) {
  return invokeCommand<void>('update_managed_window_status', { payload: status });
}
export function reserveNativeWindowTargets(identities: WindowIdentity[]) {
  return invokeCommand<void>('reserve_window_targets', { identities });
}
export function releaseNativeWindowTargets() {
  return invokeCommand<void>('release_window_targets');
}
export function retargetNativeWindow(identity: WindowIdentity, title: string) {
  return invokeCommand<void>('retarget_managed_window', { identity, title });
}
export function closeNativeSessionWindows(sessionId: string) {
  return invokeCommand<boolean>('request_session_window_close', { sessionId });
}
export function cancelNativeWindowClose(requestId: number) {
  return invokeCommand<void>('cancel_window_close_request', { requestId });
}
