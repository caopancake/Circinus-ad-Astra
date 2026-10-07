import { WINDOW_EVENTS, type EditorPreviewDraftUpdatedEvent, type EditorSpecSavedEvent } from '@/windows/window.events';
import { emitWindowEvent, listenWindowEvent, type WindowEventHandler } from '@/windows/tauri.events';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';

export function emitEditorSpecSaved(event: EditorSpecSavedEvent) {
  return emitWindowEvent(WINDOW_EVENTS.editorSpecSaved, event);
}

export function listenEditorSpecSaved(handler: WindowEventHandler<EditorSpecSavedEvent>) {
  return listenWindowEvent<EditorSpecSavedEvent>(WINDOW_EVENTS.editorSpecSaved, handler, recordWindowEventHandlerError);
}

export function listenEditorPreviewDraftUpdated(handler: WindowEventHandler<EditorPreviewDraftUpdatedEvent>) {
  return listenWindowEvent<EditorPreviewDraftUpdatedEvent>(WINDOW_EVENTS.editorPreviewDraftUpdated, handler, recordWindowEventHandlerError);
}
