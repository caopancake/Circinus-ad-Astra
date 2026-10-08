import { invoke } from '@tauri-apps/api/core';
import type {
  AssociatedFileChange,
  AssociatedSpecChange,
  CsvRowPatch,
  DeleteIndexedConfigEntityWrite,
  DeleteSkinEntityWrite,
  DeleteVariantEntityWrite,
  EditorSpecKind,
  FileChangeReplayDirection,
  IndexedConfigEntityWrite,
  JsonWriteOptions,
  ProjectSessionId,
  RowData,
  SkinEntityWrite,
  TableKey,
  VariantEntityWrite,
  WriteResult,
} from '@/shared/types';

export function saveCsvPatch(
  sessionId: ProjectSessionId,
  modRoot: string,
  table: TableKey,
  patches: CsvRowPatch[],
  associatedSpecs: AssociatedSpecChange[],
  jsonWrite?: JsonWriteOptions,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  return invoke('save_csv_patch', {
    payload: { baseVersions, sessionId, modRoot, table, patches, associatedSpecs, ...(jsonWrite ? { jsonWrite } : {}) },
  });
}

export function saveTextFile(
  sessionId: ProjectSessionId | null,
  modRoot: string,
  path: string,
  text: string,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  return invoke('save_text_file', { payload: { baseVersions, sessionId, modRoot, path, text } });
}

export function transcodeFileToUtf8(
  sessionId: ProjectSessionId | null,
  modRoot: string,
  path: string,
  encoding: string,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  return invoke('transcode_file_to_utf8', { payload: { baseVersions, sessionId, modRoot, path, encoding } });
}

export function saveEditorSpec(
  sessionId: ProjectSessionId,
  modRoot: string,
  kind: EditorSpecKind,
  id: string,
  data: RowData,
  jsonWrite?: JsonWriteOptions,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  return invoke('save_editor_spec', {
    payload: { baseVersions, sessionId, modRoot, kind, id, data, ...(jsonWrite ? { jsonWrite, orderedJson: JSON.stringify(data) } : {}) },
  });
}

export function saveModInfo(
  sessionId: ProjectSessionId,
  modRoot: string,
  data: RowData,
  jsonWrite: JsonWriteOptions,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  return invoke('save_mod_info', { payload: { baseVersions, sessionId, modRoot, data, jsonWrite, orderedJson: JSON.stringify(data) } });
}

export function saveModFiles(
  sessionId: ProjectSessionId,
  modRoot: string,
  files: AssociatedFileChange[],
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  return invoke('save_mod_files', { payload: { baseVersions, sessionId, modRoot, files } });
}

export function applyFileChangeSet(
  sessionId: ProjectSessionId,
  modRoot: string,
  direction: FileChangeReplayDirection,
  entryId: number,
  revision: number,
): Promise<WriteResult> {
  return invoke('apply_file_change_set', { payload: { sessionId, modRoot, direction, entryId, revision } });
}

export function queryFileHistory(sessionId: string, modRoot: string): Promise<import('@/shared/types').FileHistorySnapshot> {
  return invoke('query_file_history', { payload: { sessionId, modRoot } });
}

export function clearFileHistory(sessionId: string, modRoot: string): Promise<import('@/shared/types').FileHistorySnapshot> {
  return invoke('clear_file_history', { payload: { sessionId, modRoot } });
}

export function saveIndexedConfigEntity(write: IndexedConfigEntityWrite, jsonWrite?: JsonWriteOptions): Promise<WriteResult> {
  return invoke('save_indexed_config_entity', {
    payload: {
      modRoot: write.modRoot,
      baseVersions: write.baseVersions,
      sessionId: write.sessionId,
      kind: write.kind,
      previousId: write.previousId,
      nextId: write.nextId,
      indexRow: write.indexRow,
      entityData: write.entityData,
      deletePreviousTarget: write.deletePreviousTarget,
      ...(jsonWrite
        ? { jsonWrite, orderedJson: JSON.stringify(write.kind === 'faction' ? write.entityData.file : write.entityData.descriptor) }
        : {}),
    },
  });
}

export function createIndexedConfigEntity(write: IndexedConfigEntityWrite): Promise<WriteResult> {
  return invoke('create_indexed_config_entity', {
    payload: {
      modRoot: write.modRoot,
      baseVersions: write.baseVersions,
      sessionId: write.sessionId,
      kind: write.kind,
      previousId: write.previousId,
      nextId: write.nextId,
      indexRow: write.indexRow,
      entityData: write.entityData,
      deletePreviousTarget: write.deletePreviousTarget,
    },
  });
}

export function deleteIndexedConfigEntity(write: DeleteIndexedConfigEntityWrite): Promise<WriteResult> {
  return invoke('delete_indexed_config_entity', { payload: write });
}

export function saveVariantEntity(write: VariantEntityWrite, jsonWrite?: JsonWriteOptions): Promise<WriteResult> {
  return invoke('save_variant_entity', {
    payload: { ...write, ...(jsonWrite ? { jsonWrite, orderedJson: JSON.stringify(write.data) } : {}) },
  });
}

export function createVariantEntity(write: VariantEntityWrite): Promise<WriteResult> {
  return invoke('create_variant_entity', { payload: write });
}

export function deleteVariantEntity(write: DeleteVariantEntityWrite): Promise<WriteResult> {
  return invoke('delete_variant_entity', { payload: write });
}

export function saveSkinEntity(write: SkinEntityWrite, jsonWrite?: JsonWriteOptions): Promise<WriteResult> {
  return invoke('save_skin_entity', {
    payload: { ...write, ...(jsonWrite ? { jsonWrite, orderedJson: JSON.stringify(write.data) } : {}) },
  });
}

export function createSkinEntity(write: SkinEntityWrite): Promise<WriteResult> {
  return invoke('create_skin_entity', { payload: write });
}

export function deleteSkinEntity(write: DeleteSkinEntityWrite): Promise<WriteResult> {
  return invoke('delete_skin_entity', { payload: write });
}
