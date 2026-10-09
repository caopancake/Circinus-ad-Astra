import {
  openManagedWindow,
  updateManagedWindowStatus,
  reserveWindowTargets,
  releaseWindowTargets,
  retargetManagedWindow,
  requestSessionWindowClose,
  cancelWindowCloseRequest,
} from '@/shared/api/window-api';
import { withCause } from '@/shared/lib/errors';
import type { ManagedWindowStatus, NativeWindowRequest, WindowIdentity } from '@/shared/types';

export async function openNativeManagedWindow(request: NativeWindowRequest) {
  try {
    return await openManagedWindow(request);
  } catch (error) {
    throw withCause(`打开窗口「${request.title}」失败`, error, 'open-managed-window');
  }
}
export function updateNativeWindowStatus(status: ManagedWindowStatus) {
  return updateManagedWindowStatus(status);
}
export function reserveNativeWindowTargets(identities: WindowIdentity[]) {
  return reserveWindowTargets(identities);
}
export function releaseNativeWindowTargets() {
  return releaseWindowTargets();
}
export function retargetNativeWindow(identity: WindowIdentity, title: string) {
  return retargetManagedWindow(identity, title);
}
export function closeNativeSessionWindows(sessionId: string) {
  return requestSessionWindowClose(sessionId);
}
export function cancelNativeWindowClose(requestId: number) {
  return cancelWindowCloseRequest(requestId);
}
