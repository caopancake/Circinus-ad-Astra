import { rowSpecId } from '@/shared/lib/starsector';
import type { EditorWindowKind, EntityKind, CsvRow, TableKey } from '@/shared/types';
import { isCsvCommentRow } from '@/domain/tables/csv-comment-row';
import { associatedSpecEditorKinds, associatedSpecKind } from '@/domain/tables/associated-specs';
import { editorWindowLabel } from '@/domain/editors/editor-definitions';

export type TableDetailAction =
  | { type: 'file-editor'; modRoot: string; kind: EntityKind; id: string; sessionId: string; title: string }
  | {
      type: 'editor-window';
      kind: EditorWindowKind;
      modRoot: string;
      sessionId: string;
      starsectorRoot: string | null;
      id: string;
    };

export interface TableDetailActionContext {
  modRoot: string;
  sessionId: string;
  starsectorRoot: string | null;
}

export function detailActionsForRow(
  context: TableDetailActionContext,
  table: TableKey,
  row: CsvRow | null | undefined,
): TableDetailAction[] {
  if (!row) return [];
  if (isCsvCommentRow(row)) return [];
  const id = rowSpecId(row.data, table);
  if (!id) return [];
  const specKind = associatedSpecKind(table);
  const editorActions: TableDetailAction[] = associatedSpecEditorKinds(table).map((kind) => ({
    type: 'editor-window' as const,
    kind,
    modRoot: context.modRoot,
    sessionId: context.sessionId,
    starsectorRoot: context.starsectorRoot,
    id,
  }));
  return specKind ? [...editorActions, specFileAction(context, specKind, id)] : editorActions;
}

export function detailActionLabel(action: TableDetailAction): string {
  if (action.type === 'file-editor') return '文件编辑器';
  return editorWindowLabel(action.kind);
}

export function detailActionKey(action: TableDetailAction): string {
  return action.type === 'file-editor'
    ? JSON.stringify([action.type, action.kind, action.modRoot, action.sessionId, action.id])
    : JSON.stringify([action.type, action.kind, action.modRoot, action.sessionId, action.id]);
}

function specFileAction(context: TableDetailActionContext, kind: EntityKind, id: string): TableDetailAction {
  return {
    type: 'file-editor',
    modRoot: context.modRoot,
    kind,
    id,
    sessionId: context.sessionId,
    title: '文件编辑器',
  };
}
