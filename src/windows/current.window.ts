import { getCurrentWindow, type CloseRequestedEvent } from '@tauri-apps/api/window';
import type { UnlistenFn } from '@tauri-apps/api/event';

function appWindow() {
  return getCurrentWindow();
}
export function currentWindowLabel(): string {
  return appWindow().label;
}

export async function closeCurrentWindow(): Promise<void> {
  await appWindow().close();
}

export async function destroyCurrentWindow(): Promise<void> {
  await appWindow().destroy();
}

export function listenCurrentWindowCloseRequest(handler: (event: CloseRequestedEvent) => void | Promise<void>): Promise<UnlistenFn> {
  return appWindow().onCloseRequested(handler);
}

export async function minimizeCurrentWindow(): Promise<void> {
  await appWindow().minimize();
}

export async function toggleMaximizeCurrentWindow(): Promise<void> {
  await appWindow().toggleMaximize();
}

export async function isCurrentWindowMaximized(): Promise<boolean> {
  return appWindow().isMaximized();
}

export async function startCurrentWindowDrag(): Promise<void> {
  await appWindow().startDragging();
}

export async function reloadCurrentWindow(): Promise<void> {
  window.location.reload();
}

export async function showCurrentWindow(): Promise<void> {
  await appWindow().show();
}
