import { invokeCommand } from '@/shared/runtime/command.runtime';
import type { PersistedWorkspace } from '@/shared/types';

export function loadPersistedWorkspace(): Promise<PersistedWorkspace> {
  return invokeCommand('load_workspace');
}

export function savePersistedWorkspace(state: PersistedWorkspace): Promise<void> {
  return invokeCommand('save_workspace', { payload: { state } });
}
