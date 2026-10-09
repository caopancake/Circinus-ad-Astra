import { invoke } from '@tauri-apps/api/core';
import type { ManagedWindowOpened, ManagedWindowStatus, NativeWindowRequest, WindowIdentity } from '@/shared/types';

export function openManagedWindow(payload: NativeWindowRequest): Promise<ManagedWindowOpened> {
  return invoke('open_managed_window', { payload });
}
export function updateManagedWindowStatus(payload: ManagedWindowStatus): Promise<void> {
  return invoke('update_managed_window_status', { payload });
}
export function reserveWindowTargets(identities: WindowIdentity[]): Promise<void> {
  return invoke('reserve_window_targets', { identities });
}
export function releaseWindowTargets(): Promise<void> {
  return invoke('release_window_targets');
}
export function retargetManagedWindow(identity: WindowIdentity, title: string): Promise<void> {
  return invoke('retarget_managed_window', { identity, title });
}
export function requestSessionWindowClose(sessionId: string): Promise<boolean> {
  return invoke('request_session_window_close', { sessionId });
}
export function cancelWindowCloseRequest(requestId: number): Promise<void> {
  return invoke('cancel_window_close_request', { requestId });
}
