import { WINDOW_EVENTS, type EntityIdentityAppliedEvent } from '@/windows/window.events';
import { emitWindowEvent, listenWindowEvent, type WindowEventHandler } from '@/windows/tauri.events';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';

export function emitEntityIdentityApplied(event: EntityIdentityAppliedEvent) {
  if (
    event.result.identityChanges.some(
      (change) => change.before.id !== change.after.id || change.before.write.path !== change.after.write.path,
    )
  )
    return emitWindowEvent(WINDOW_EVENTS.entityIdentityApplied, event);
  return Promise.resolve();
}
export function listenEntityIdentityApplied(handler: WindowEventHandler<EntityIdentityAppliedEvent>) {
  return listenWindowEvent(WINDOW_EVENTS.entityIdentityApplied, handler, recordWindowEventHandlerError);
}
