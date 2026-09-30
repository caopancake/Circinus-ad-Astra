import type { AppFeedback, IndexedConfigKind, SkinFile, VariantFile, WriteResult } from '@/shared/types';
import type { RowData } from '@/shared/types';
import {
  writeCreateIndexedConfigEntity,
  writeCreateSkinEntity,
  writeCreateVariantEntity,
  writeDeleteIndexedConfigEntity,
  writeDeleteSkinEntity,
  writeDeleteVariantEntity,
  writeIndexedConfigEntity,
  writeModInfo,
  writeModFiles,
  writeSkinEntity,
  writeVariantEntity,
} from '@/services/write.service';
import { createDefaultSkin, createDefaultVariant, indexedConfigHistoryLabel } from '@/domain/config/config-entities';
import { indexedConfigEntityData, skinEntityData, variantEntityData } from '@/domain/config/config-records';
import { useProjectStore } from '@/stores/project.store';
import { completeSavedWrite } from '@/orchestrators/file-history-write.orchestrator';
import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';

export async function saveModInfoAction(
  sessionId: string,
  modRoot: string,
  data: RowData,
  feedback?: AppFeedback,
): Promise<WriteResult | null> {
  const result = await runConfirmedJsonWrite(feedback, (options) =>
    options.preserveOriginalJson
      ? writeModInfo(sessionId, modRoot, data, options)
      : writeModFiles(sessionId, modRoot, [{ relPath: 'mod_info.json', afterText: JSON.stringify(data, null, 2), afterDataBase64: null }]),
  );
  if (!result) return null;
  await recordConfigWrite(modRoot, sessionId, result, '保存 mod_info.json');
  return result;
}

export async function saveIndexedEntityAction(
  write: {
    sessionId: string;
    modRoot: string;
    kind: IndexedConfigKind;
    previousId: string | null;
    nextId: string;
    indexRow: RowData;
    entityData: RowData;
    deletePreviousTarget: boolean;
  },
  feedback?: AppFeedback,
): Promise<string | null> {
  const result = await runConfirmedJsonWrite(feedback, (options) => writeIndexedConfigEntity(write, options));
  if (!result) return null;
  const entity = indexedConfigEntityData(result);
  await recordConfigWrite(write.modRoot, write.sessionId, result, indexedConfigHistoryLabel(write.kind, 'save', entity.entityId));
  return entity.entityId;
}

export async function createIndexedEntityAction(write: {
  sessionId: string;
  modRoot: string;
  kind: IndexedConfigKind;
  previousId: null;
  nextId: string;
  indexRow: RowData;
  entityData: RowData;
  deletePreviousTarget: false;
}): Promise<string> {
  const result = await writeCreateIndexedConfigEntity(write);
  const entity = indexedConfigEntityData(result);
  await recordConfigWrite(write.modRoot, write.sessionId, result, indexedConfigHistoryLabel(write.kind, 'create', entity.entityId));
  return entity.entityId;
}

export async function deleteIndexedEntityAction(
  sessionId: string,
  modRoot: string,
  kind: IndexedConfigKind,
  id: string,
  deleteTarget: boolean,
): Promise<string> {
  const result = await writeDeleteIndexedConfigEntity({ sessionId, modRoot, kind, id, deleteTarget });
  await recordConfigWrite(modRoot, sessionId, result, indexedConfigHistoryLabel(kind, 'delete', id));
  return indexedConfigEntityData(result).entityId;
}

export async function saveVariantAction(
  sessionId: string,
  modRoot: string,
  variantId: string,
  data: RowData,
  previousId: string | null,
  feedback?: AppFeedback,
): Promise<VariantFile | null> {
  const write = {
    sessionId,
    modRoot,
    previousId,
    nextId: variantId,
    data,
  };
  const result = await runConfirmedJsonWrite(feedback, (options) => writeVariantEntity(write, options));
  if (!result) return null;
  const variant = variantEntityData(result);
  await recordConfigWrite(modRoot, sessionId, result, `保存装配 ${variant.variantId}`);
  return variant;
}

export async function createVariantAction(sessionId: string, modRoot: string, hullId: string, variantId: string): Promise<VariantFile> {
  const result = await writeCreateVariantEntity({
    sessionId,
    modRoot,
    previousId: null,
    nextId: variantId,
    data: createDefaultVariant(hullId, variantId),
  });
  const variant = variantEntityData(result);
  await recordConfigWrite(modRoot, sessionId, result, `创建装配 ${variant.variantId}`);
  return variant;
}

export async function deleteVariantAction(sessionId: string, modRoot: string, relPath: string, variantId: string): Promise<WriteResult> {
  const result = await writeDeleteVariantEntity({ sessionId, modRoot, relPath, entityId: variantId });
  await recordConfigWrite(modRoot, sessionId, result, `删除装配 ${variantId}`);
  return result;
}

export async function saveSkinAction(
  sessionId: string,
  modRoot: string,
  skinHullId: string,
  data: RowData,
  previousId: string | null,
  feedback?: AppFeedback,
): Promise<SkinFile | null> {
  const write = {
    sessionId,
    modRoot,
    previousId,
    nextId: skinHullId,
    data,
  };
  const result = await runConfirmedJsonWrite(feedback, (options) => writeSkinEntity(write, options));
  if (!result) return null;
  const skin = skinEntityData(result);
  await recordConfigWrite(modRoot, sessionId, result, `保存舰船皮肤 ${skin.skinHullId}`);
  return skin;
}

export async function createSkinAction(sessionId: string, modRoot: string, baseHullId: string, skinHullId: string): Promise<SkinFile> {
  const result = await writeCreateSkinEntity({
    sessionId,
    modRoot,
    previousId: null,
    nextId: skinHullId,
    data: createDefaultSkin(baseHullId, skinHullId),
  });
  const skin = skinEntityData(result);
  await recordConfigWrite(modRoot, sessionId, result, `创建舰船皮肤 ${skin.skinHullId}`);
  return skin;
}

export async function deleteSkinAction(sessionId: string, modRoot: string, relPath: string, skinHullId: string): Promise<WriteResult> {
  const result = await writeDeleteSkinEntity({ sessionId, modRoot, relPath, entityId: skinHullId });
  await recordConfigWrite(modRoot, sessionId, result, `删除舰船皮肤 ${skinHullId}`);
  return result;
}

async function recordConfigWrite(modRoot: string, sessionId: string, result: WriteResult, label: string) {
  if (result.changes.length === 0) return;
  await completeSavedWrite({ modRoot, sessionId, result, label }, useProjectStore());
}
