import { listenCommittedWrites } from '@/orchestrators/project-session-refresh.orchestrator';
import type { EditorSpecSavedEvent } from '@/windows/window.events';
import type { WindowEventHandler } from '@/windows/tauri.events';

interface WindowSaveEventHandlers {
  onEditorSpecSaved?: WindowEventHandler<EditorSpecSavedEvent>;
}
export function listenWindowSaveEvents(handlers: WindowSaveEventHandlers = {}) {
  return listenCommittedWrites(async (event) => {
    if (!event.sessionId || !event.result.refreshedEntity) return;
    for (const change of event.result.identityChanges) {
      const kind = change.after.kind;
      if (
        (kind === 'ship' || kind === 'weapon' || kind === 'projectile' || kind === 'system') &&
        typeof event.result.refreshedEntity[kind === 'ship' ? 'hullId' : 'id'] === 'string'
      )
        await handlers.onEditorSpecSaved?.({
          kind,
          sessionId: event.sessionId,
          modRoot: event.modRoot,
          id: change.after.id,
          spec: event.result.refreshedEntity,
          writeResult: event.result,
        });
    }
  });
}
