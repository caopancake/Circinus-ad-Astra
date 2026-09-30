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
import { AppError } from '@/shared/lib/errors';
import type {
  AssociatedFileChange,
  AssociatedSpecChange,
  CsvRowPatch,
  DeleteIndexedConfigEntityWrite,
  DeleteSkinEntityWrite,
  DeleteVariantEntityWrite,
  FileChangeRecord,
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

const inFlightTargets = new Set<string>();

async function runExclusiveWrite<T>(target: string, operation: () => Promise<T>): Promise<T> {
  if (inFlightTargets.has(target)) {
    throw new AppError('相同目标的保存正在进行，请等待其完成', { action: 'exclusive-write' });
  }
  inFlightTargets.add(target);
  try {
    return await operation();
  } finally {
    inFlightTargets.delete(target);
  }
}

export async function writeCsvPatch(
  sessionId: string,
  modRoot: string,
  table: TableKey,
  patches: CsvRowPatch[],
  associatedSpecs: AssociatedSpecChange[],
  jsonWrite?: JsonWriteOptions,
): Promise<WriteResult> {
  return runExclusiveWrite(`csv:${sessionId}:${table}`, () => saveCsvPatch(sessionId, modRoot, table, patches, associatedSpecs, jsonWrite));
}

export async function writeTextFile(sessionId: string | null, modRoot: string, path: string, text: string): Promise<WriteResult> {
  return runExclusiveWrite(`text:${modRoot}:${path}`, () => saveTextFile(sessionId, modRoot, path, text));
}

export async function writeTranscodedFile(sessionId: string | null, modRoot: string, path: string, encoding: string): Promise<WriteResult> {
  return runExclusiveWrite(`text:${modRoot}:${path}`, () => transcodeFileToUtf8(sessionId, modRoot, path, encoding));
}

export async function writeEditorSpec(
  sessionId: string,
  modRoot: string,
  kind: EditorSpecKind,
  id: string,
  data: RowData,
  jsonWrite?: JsonWriteOptions,
): Promise<WriteResult> {
  return runExclusiveWrite(`spec:${kind}:${modRoot}:${id}`, () => saveEditorSpec(sessionId, modRoot, kind, id, data, jsonWrite));
}

export async function writeModInfo(sessionId: string, modRoot: string, data: RowData, jsonWrite: JsonWriteOptions): Promise<WriteResult> {
  return runExclusiveWrite(`mod-info:${sessionId}:${modRoot}`, () => saveModInfo(sessionId, modRoot, data, jsonWrite));
}

export async function writeModFiles(sessionId: string, modRoot: string, files: AssociatedFileChange[]): Promise<WriteResult> {
  return runExclusiveWrite(`mod-files:${sessionId}:${modRoot}`, () => saveModFiles(sessionId, modRoot, files));
}

export async function writeIndexedConfigEntity(write: IndexedConfigEntityWrite, jsonWrite?: JsonWriteOptions): Promise<WriteResult> {
  return runExclusiveWrite(`indexed-save:${write.sessionId}:${write.kind}:${write.nextId}`, () =>
    saveIndexedConfigEntity(write, jsonWrite),
  );
}

export async function writeCreateIndexedConfigEntity(write: IndexedConfigEntityWrite): Promise<WriteResult> {
  return runExclusiveWrite(`indexed-create:${write.sessionId}:${write.kind}:${write.nextId}`, () => createIndexedConfigEntity(write));
}

export async function writeDeleteIndexedConfigEntity(write: DeleteIndexedConfigEntityWrite): Promise<WriteResult> {
  return runExclusiveWrite(`indexed-delete:${write.sessionId}:${write.kind}:${write.id}`, () => deleteIndexedConfigEntity(write));
}

export async function writeVariantEntity(write: VariantEntityWrite, jsonWrite?: JsonWriteOptions): Promise<WriteResult> {
  return runExclusiveWrite(`variant-save:${write.sessionId}:${write.nextId}`, () => saveVariantEntity(write, jsonWrite));
}

export async function writeCreateVariantEntity(write: VariantEntityWrite): Promise<WriteResult> {
  return runExclusiveWrite(`variant-create:${write.sessionId}:${write.nextId}`, () => createVariantEntity(write));
}

export async function writeDeleteVariantEntity(write: DeleteVariantEntityWrite): Promise<WriteResult> {
  return runExclusiveWrite(`variant-delete:${write.sessionId}:${write.relPath}`, () => deleteVariantEntity(write));
}

export async function writeSkinEntity(write: SkinEntityWrite, jsonWrite?: JsonWriteOptions): Promise<WriteResult> {
  return runExclusiveWrite(`skin-save:${write.sessionId}:${write.nextId}`, () => saveSkinEntity(write, jsonWrite));
}

export async function writeCreateSkinEntity(write: SkinEntityWrite): Promise<WriteResult> {
  return runExclusiveWrite(`skin-create:${write.sessionId}:${write.nextId}`, () => createSkinEntity(write));
}

export async function writeDeleteSkinEntity(write: DeleteSkinEntityWrite): Promise<WriteResult> {
  return runExclusiveWrite(`skin-delete:${write.sessionId}:${write.relPath}`, () => deleteSkinEntity(write));
}

export async function replayFileChangeSet(
  sessionId: string,
  modRoot: string,
  direction: FileChangeReplayDirection,
  changes: FileChangeRecord[],
): Promise<WriteResult> {
  return runExclusiveWrite(`replay:${sessionId}:${modRoot}:${direction}`, () => applyFileChangeSet(sessionId, modRoot, direction, changes));
}
