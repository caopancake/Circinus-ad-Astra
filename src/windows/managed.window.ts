import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { openNativeManagedWindow } from '@/services/window.service';
import type { WindowIdentity } from '@/shared/types';

export interface ManagedWindowSize {
  height: number;
  minHeight: number;
  minWidth: number;
  width: number;
}

export interface ManagedWindowRequest {
  focusEvent?: { data: unknown; name: string };
  identity: WindowIdentity;
  title: string;
  urlParams: Record<string, string | number | null | undefined>;
  size: ManagedWindowSize;
}

export const MANAGED_WINDOW_QUERY_MAX_LENGTH = 12000;

export async function openManagedWindow(request: ManagedWindowRequest): Promise<void> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(request.urlParams)) {
    if (value !== null && value !== undefined) query.set(key, String(value));
  }
  const queryString = query.toString();
  if (queryString.length > MANAGED_WINDOW_QUERY_MAX_LENGTH) {
    throw new Error(`窗口「${request.title}」参数超出长度限制（${queryString.length} > ${MANAGED_WINDOW_QUERY_MAX_LENGTH}），已取消打开`);
  }
  const opened = await openNativeManagedWindow({
    identity: request.identity,
    title: request.title,
    url: `/?${queryString}`,
    ...request.size,
  });
  if (opened.reused && request.focusEvent) {
    const window = await WebviewWindow.getByLabel(opened.label);
    await window!.emit(request.focusEvent.name, request.focusEvent.data);
  }
}
