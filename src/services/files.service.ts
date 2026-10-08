import * as filesApi from '@/shared/api/files-api';
import type { EditableFileData, EditorSpecKind, WriteResult } from '@/shared/types';
import { writeTextFile, writeTranscodedFile } from '@/services/write.service';
import type { RowData } from '@/shared/types';

export function loadEditableFileData(sessionId: string | null, modRoot: string, path: string): Promise<EditableFileData> {
  return filesApi.loadEditableFile(sessionId, modRoot, path);
}

export function writeEditableFileText(
  sessionId: string | null,
  modRoot: string,
  path: string,
  text: string,
  baseVersions: import('@/shared/types').FileVersion[],
): Promise<WriteResult> {
  return writeTextFile(sessionId, modRoot, path, text, baseVersions);
}

export function transcodeFileToUtf8(sessionId: string | null, modRoot: string, path: string, encoding: string): Promise<WriteResult> {
  return writeTranscodedFile(sessionId, modRoot, path, encoding);
}

export function loadImportedEditorSpecFile(kind: EditorSpecKind, path: string): Promise<RowData> {
  return filesApi.loadImportedEditorSpecFile(kind, path);
}
