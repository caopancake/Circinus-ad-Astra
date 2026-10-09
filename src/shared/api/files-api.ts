import { invokeCommand } from '@/shared/runtime/command.runtime';
import type { EditableFileData, EditorSpecKind, ProjectSessionId, RowData } from '@/shared/types';

export function loadEditableFile(sessionId: ProjectSessionId | null, modRoot: string, path: string): Promise<EditableFileData> {
  return invokeCommand('load_editable_file', { payload: { sessionId, modRoot, path } });
}

export function loadImportedEditorSpecFile(kind: EditorSpecKind, path: string): Promise<RowData> {
  return invokeCommand('load_imported_editor_spec_file', { payload: { kind, path } });
}

export function queryTextIdentityIntent(
  sessionId: string,
  source: import('@/shared/types').EntityEditTarget,
  text: string,
): Promise<import('@/shared/types').EntityIdentityIntent> {
  return invokeCommand('query_text_identity_intent', { payload: { sessionId, source, text } });
}
export function followTextIdentity(kind: import('@/shared/types').EntityKind, text: string, nextId: string): Promise<string> {
  return invokeCommand('follow_text_identity', { payload: { kind, text, nextId } });
}
