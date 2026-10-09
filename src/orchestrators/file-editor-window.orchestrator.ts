import {
  WINDOW_EVENTS,
  type FileEditorFocusLineEvent,
  type FileEditorSavedEvent,
  type FileEditorTextAppliedEvent,
  type ProjectSessionInvalidatedEvent,
} from '@/windows/window.events';
import { listenWindowEvent, type WindowEventHandler } from '@/windows/tauri.events';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';
import {
  publishCommittedWrite,
  listenCommittedWrites,
  listenProjectSessionInvalidated,
} from '@/orchestrators/project-session-refresh.orchestrator';
import { joinRootRelativePath, normalizeFsPath, pathBelongsToRoot } from '@/shared/lib/paths';

export function emitFileEditorSaved(event: FileEditorSavedEvent) {
  return publishCommittedWrite(event.modRoot, event.writeResult, event.sessionId);
}
export function listenFileEditorFocusLine(handler: WindowEventHandler<FileEditorFocusLineEvent>) {
  return listenWindowEvent<FileEditorFocusLineEvent>(WINDOW_EVENTS.fileEditorFocusLine, handler, recordWindowEventHandlerError);
}
export function listenFileEditorTextApplied(handler: WindowEventHandler<FileEditorTextAppliedEvent>) {
  return listenCommittedWrites(async (event) => {
    for (const scope of event.result.sessionUpdates) {
      for (const change of event.result.changes.filter(
        (change) => pathBelongsToRoot(change.beforePath, scope.modRoot) || pathBelongsToRoot(change.afterPath, scope.modRoot),
      )) {
        if (change.kind === 'directory') {
          const paths = new Set([...change.beforeFiles, ...change.afterFiles].map((file) => file.relPath));
          const after = new Map(change.afterFiles.map((file) => [normalizeFsPath(file.relPath), file]));
          for (const path of paths) {
            const file = after.get(normalizeFsPath(path));
            if (file?.dataBase64) continue;
            await handler({
              commitId: event.result.commitId,
              baseVersions: event.result.baseVersions,
              modRoot: scope.modRoot,
              sessionId: scope.sessionId,
              path: joinRootRelativePath(change.afterPath, path),
              text: file?.text ?? '',
            });
          }
        } else if (!change.afterDataBase64 && (!change.beforeDataBase64 || change.afterText !== null)) {
          await handler({
            commitId: event.result.commitId,
            baseVersions: event.result.baseVersions,
            modRoot: scope.modRoot,
            sessionId: scope.sessionId,
            path: change.afterPath,
            text: change.afterText ?? '',
          });
        }
      }
    }
  });
}
export function listenFileEditorProjectInvalidated(handler: WindowEventHandler<ProjectSessionInvalidatedEvent>) {
  return listenProjectSessionInvalidated(handler);
}
