import type { ProjectInvalidation, ProjectManifest, RowData } from '@/shared/types';
import type { WriteResult } from '@/shared/types';
import type { AppSettings } from '@/shared/types';
import type { EditorSpecKind } from '@/shared/types';

export const WINDOW_EVENTS = {
  windowCloseIntent: 'window-lifecycle-close-requested',
  managedWindowReleased: 'managed-window-released',
  entityTablePrepare: 'entity-table-prepare',
  entityTablePrepared: 'entity-table-prepared',
  entityTableRelease: 'entity-table-release',
  entityIdentityApplied: 'entity-identity-applied',
  editorSpecSaved: 'editor-spec-saved',
  editorPreviewDraftUpdated: 'editor-preview-draft-updated',
  fileEditorFocusLine: 'file-editor-focus-line',
  fileEditorSaved: 'file-editor-saved',
  fileEditorTextApplied: 'file-editor-text-applied',
  projectSessionInvalidated: 'project-session-invalidated',
  appSettingsChanged: 'app-settings-changed',
} as const;

export interface EditorPreviewDraftUpdatedEvent {
  sessionId: string;
  modRoot: string;
  id: string;
  draft: RowData;
}

export interface EditorSpecSavedEvent {
  kind: EditorSpecKind;
  sessionId: string;
  modRoot: string;
  id: string;
  spec: RowData;
  writeResult: WriteResult;
}

export type FileEditorContextSeverity = 'error' | 'warning' | 'info';

export interface FileEditorFocusLineEvent {
  column: number | null;
  contextLabel: string | null;
  contextSeverity: FileEditorContextSeverity | null;
  line: number | null;
  message: string | null;
}

export interface FileEditorSavedEvent {
  modRoot: string;
  path: string;
  sessionId: string;
  writeResult: WriteResult;
}

export interface FileEditorTextAppliedEvent {
  commitId: number;
  baseVersions: import('@/shared/types').FileVersion[];
  modRoot: string;
  path: string;
  sessionId: string;
  text: string;
}

export interface ProjectSessionInvalidatedEvent {
  manifest: ProjectManifest;
  invalidation: ProjectInvalidation;
}

export type AppSettingsChangedEvent = AppSettings;

export interface EntityTablePrepareEvent {
  requestId: string;
  ownerLabel: string;
  sessionId: string;
  modRoot: string;
  source: import('@/shared/types').EntityEditTarget;
}
export type EntityTablePreparedEvent = EntityTablePrepareEvent &
  (
    | { status: 'ready'; info: import('@/shared/types').EntityEditInfo; receipt: WriteResult | null }
    | { status: 'cancelled' }
    | { status: 'failed'; message: string }
  );
export interface EntityTableReleaseEvent {
  requestId: string;
  ownerLabel: string;
  sessionId: string;
  modRoot: string;
  receipt: WriteResult | null;
}
export interface EntityIdentityAppliedEvent {
  sessionId: string;
  modRoot: string;
  result: WriteResult;
}
