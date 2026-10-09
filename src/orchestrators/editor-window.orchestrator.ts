import { WINDOW_EVENTS, type EditorPreviewDraftUpdatedEvent, type EditorSpecSavedEvent } from '@/windows/window.events';
import { listenWindowEvent, type WindowEventHandler } from '@/windows/tauri.events';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';
import { publishCommittedWrite, listenCommittedWrites } from '@/orchestrators/project-session-refresh.orchestrator';

export function emitEditorSpecSaved(event: EditorSpecSavedEvent) {
  return publishCommittedWrite(event.modRoot, event.writeResult, event.sessionId);
}

export function listenEditorSpecSaved(handler: WindowEventHandler<EditorSpecSavedEvent>) {
  return listenCommittedWrites(async (event) => {
    if (!event.sessionId) return;
    for (const change of event.result.identityChanges) {
      const kind = change.after.kind;
      if (kind !== 'ship' && kind !== 'weapon' && kind !== 'projectile' && kind !== 'system') continue;
      const content = event.result.refreshedEntity;
      if (!content || typeof content[kind === 'ship' ? 'hullId' : 'id'] !== 'string') continue;
      await handler({
        kind,
        sessionId: event.sessionId,
        modRoot: event.modRoot,
        id: change.after.id,
        spec: content,
        writeResult: event.result,
      });
    }
  });
}
export function listenEditorPreviewDraftUpdated(handler: WindowEventHandler<EditorPreviewDraftUpdatedEvent>) {
  return listenWindowEvent<EditorPreviewDraftUpdatedEvent>(WINDOW_EVENTS.editorPreviewDraftUpdated, handler, recordWindowEventHandlerError);
}
