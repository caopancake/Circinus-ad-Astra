import { invokeCommand } from '@/shared/runtime/command.runtime';
import { queryLive } from '@/services/query-cache.service';

export function resolveModImageReference(sessionId: string, modRoot: string, absolutePath: string, signal?: AbortSignal): Promise<string> {
  return queryLive(
    { sessionId, queryKind: 'resource-reference', parameters: { modRoot, absolutePath } },
    (captured) => invokeCommand('resolve_mod_relative_path', { payload: { sessionId: captured.sessionId, ...captured.parameters } }),
    signal,
  );
}
