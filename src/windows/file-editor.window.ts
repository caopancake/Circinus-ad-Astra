import { openManagedWindow } from '@/windows/managed.window';
import { WINDOW_EVENTS, type FileEditorFocusLineEvent } from '@/windows/window.events';
import type { AppSettings, GameScanWarning, ModOpeningFailure } from '@/shared/types';
import { extractFileReferenceFromError } from '@/shared/lib/errors';

export interface FileEditorRequest {
  mode?: 'session' | 'recovery';
  modRoot: string | null;
  path: string;
  sessionId: string | null;
  title?: string;
  contextLabel?: string;
  contextSeverity?: FileEditorFocusLineEvent['contextSeverity'];
  message?: string;
  line?: number;
  column?: number;
}

export type OpenFileEditorWindowRequest = FileEditorRequest & {
  settings: AppSettings;
};

export function openGameWarningFileEditor(warning: GameScanWarning, settings: AppSettings): Promise<void> | null {
  const target = warning.editTarget;
  if (!target) return null;
  const reference = extractFileReferenceFromError(warning.message);
  return openFileEditorWindow({
    mode: 'recovery',
    modRoot: target.modRoot,
    path: target.path,
    sessionId: null,
    line: reference?.line,
    column: reference?.column,
    settings,
    title: '文件编辑器',
    contextLabel: '错误',
    contextSeverity: 'error',
    message: warning.message,
  });
}

export function openModOpeningFailureFileEditor(failure: ModOpeningFailure, settings: AppSettings): Promise<void> | null {
  const target = failure.file;
  if (!target) return null;
  return openFileEditorWindow({
    mode: 'recovery',
    modRoot: failure.modRoot,
    path: target.path,
    sessionId: null,
    line: target.line,
    column: target.column,
    settings,
    title: '文件编辑器',
    contextLabel: '错误',
    contextSeverity: 'error',
    message: failure.message,
  });
}

export function openFileEditorWindow(request: OpenFileEditorWindowRequest): Promise<void> {
  return openManagedWindow({
    identity:
      request.mode === 'recovery'
        ? { type: 'recovery', modRoot: request.modRoot, path: request.path }
        : { type: 'file', sessionId: request.sessionId!, modRoot: request.modRoot!, path: request.path },
    title: request.title ?? '文件编辑器',
    urlParams: {
      window: 'file-editor',
      modRoot: request.modRoot,
      sessionId: request.sessionId,
      file: request.path,
      title: request.title,
      contextLabel: request.contextLabel,
      contextSeverity: request.contextSeverity,
      message: request.message,
      line: request.line,
      column: request.column,
      mode: request.mode ?? 'session',
      settings: JSON.stringify(request.settings),
    },
    size: {
      width: 1040,
      height: 760,
      minWidth: 780,
      minHeight: 520,
    },
    focusEvent: {
      name: WINDOW_EVENTS.fileEditorFocusLine,
      data: {
        column: request.column ?? null,
        line: request.line ?? null,
        message: request.message ?? null,
        contextLabel: request.contextLabel ?? null,
        contextSeverity: request.contextSeverity ?? null,
      } satisfies FileEditorFocusLineEvent,
    },
  });
}
