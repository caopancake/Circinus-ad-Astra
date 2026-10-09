import type { EntityIdentityAppliedEvent } from '@/windows/window.events';
import type { WindowEventHandler } from '@/windows/tauri.events';
import { listenCommittedWrites } from '@/orchestrators/project-session-refresh.orchestrator';

export function listenEntityIdentityApplied(handler: WindowEventHandler<EntityIdentityAppliedEvent>) {
  return listenCommittedWrites(
    async (event) => {
      if (
        event.sessionId &&
        event.result.identityChanges.some(
          (change) => change.before.id !== change.after.id || change.before.write.path !== change.after.write.path,
        )
      )
        await handler({ sessionId: event.sessionId, modRoot: event.modRoot, result: event.result });
    },
    () => true,
    'identity',
  );
}
