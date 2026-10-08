import {
  applyFileChangeSet,
  createIndexedConfigEntity,
  createSkinEntity,
  createVariantEntity,
  deleteIndexedConfigEntity,
  deleteSkinEntity,
  deleteVariantEntity,
  saveCsvPatch,
  saveEditorSpec,
  saveIndexedConfigEntity,
  saveModFiles,
  saveModInfo,
  saveSkinEntity,
  saveTextFile,
  saveVariantEntity,
  transcodeFileToUtf8,
} from '@/shared/api/write-api';
import type {
  AssociatedFileChange,
  AssociatedSpecChange,
  CsvRowPatch,
  DeleteIndexedConfigEntityWrite,
  DeleteSkinEntityWrite,
  DeleteVariantEntityWrite,
  FileChangeReplayDirection,
  IndexedConfigEntityWrite,
  JsonWriteOptions,
  EditorSpecKind,
  RowData,
  SkinEntityWrite,
  TableKey,
  VariantEntityWrite,
  WriteResult,
} from '@/shared/types';

export async function writeCsvPatch(
  sessionId: string,
  modRoot: string,
  table: TableKey,
  patches: CsvRowPatch[],
  associatedSpecs: AssociatedSpecChange[],
  jsonWrite?: JsonWriteOptions,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  return saveCsvPatch(sessionId, modRoot, table, patches, associatedSpecs, jsonWrite, baseVersions);
}

export async function writeTextFile(
  sessionId: string | null,
  modRoot: string,
  path: string,
  text: string,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  return saveTextFile(sessionId, modRoot, path, text, baseVersions);
}

export async function writeTranscodedFile(
  sessionId: string | null,
  modRoot: string,
  path: string,
  encoding: string,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  return transcodeFileToUtf8(sessionId, modRoot, path, encoding, baseVersions);
}

export async function writeEditorSpec(
  sessionId: string,
  modRoot: string,
  kind: EditorSpecKind,
  id: string,
  data: RowData,
  jsonWrite?: JsonWriteOptions,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  return saveEditorSpec(sessionId, modRoot, kind, id, data, jsonWrite, baseVersions);
}

export async function writeModInfo(
  sessionId: string,
  modRoot: string,
  data: RowData,
  jsonWrite: JsonWriteOptions,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  return saveModInfo(sessionId, modRoot, data, jsonWrite, baseVersions);
}

export async function writeModFiles(
  sessionId: string,
  modRoot: string,
  files: AssociatedFileChange[],
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  return saveModFiles(sessionId, modRoot, files, baseVersions);
}

export async function writeIndexedConfigEntity(write: IndexedConfigEntityWrite, jsonWrite?: JsonWriteOptions): Promise<WriteResult> {
  return saveIndexedConfigEntity(write, jsonWrite);
}

export async function writeCreateIndexedConfigEntity(write: IndexedConfigEntityWrite): Promise<WriteResult> {
  return createIndexedConfigEntity(write);
}

export async function writeDeleteIndexedConfigEntity(write: DeleteIndexedConfigEntityWrite): Promise<WriteResult> {
  return deleteIndexedConfigEntity(write);
}

export async function writeVariantEntity(write: VariantEntityWrite, jsonWrite?: JsonWriteOptions): Promise<WriteResult> {
  return saveVariantEntity(write, jsonWrite);
}

export async function writeCreateVariantEntity(write: VariantEntityWrite): Promise<WriteResult> {
  return createVariantEntity(write);
}

export async function writeDeleteVariantEntity(write: DeleteVariantEntityWrite): Promise<WriteResult> {
  return deleteVariantEntity(write);
}

export async function writeSkinEntity(write: SkinEntityWrite, jsonWrite?: JsonWriteOptions): Promise<WriteResult> {
  return saveSkinEntity(write, jsonWrite);
}

export async function writeCreateSkinEntity(write: SkinEntityWrite): Promise<WriteResult> {
  return createSkinEntity(write);
}

export async function writeDeleteSkinEntity(write: DeleteSkinEntityWrite): Promise<WriteResult> {
  return deleteSkinEntity(write);
}

export async function replayFileChangeSet(
  sessionId: string,
  modRoot: string,
  direction: FileChangeReplayDirection,
  entryId: number,
  revision: number,
): Promise<WriteResult> {
  return applyFileChangeSet(sessionId, modRoot, direction, entryId, revision);
}
