import { invokeCommand } from '@/shared/runtime/command.runtime';
import type { DiscoveredField } from '@/shared/types';

export function queryCoreFields(starsectorRoot: string): Promise<Record<string, DiscoveredField[]>> {
  return invokeCommand('scan_core_fields', { payload: { starsectorRoot } });
}

export function queryCoreGraphics(starsectorRoot: string): Promise<string[]> {
  return invokeCommand('scan_core_graphics', { payload: { starsectorRoot } });
}

export function invalidateCoreCacheForRoot(starsectorRoot: string): Promise<void> {
  return invokeCommand('invalidate_core_cache', { payload: { starsectorRoot } });
}
