import type { AppFeedback, SavedConfig, IndexedConfigKind, SkinFile, VariantFile, WriteResult } from '@/shared/types';
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
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult | null> {
  const result = await runConfirmedJsonWrite(feedback, (options) => writeModInfo(sessionId, modRoot, data, options, baseVersions));
  if (!result) return null;
  return result;
}

export async function saveIndexedEntityAction(
  write: {
    baseVersions: import('@/shared/types').FileVersion[];
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
): Promise<SavedConfig<import('@/shared/types').IndexedConfigEntityData> | null> {
  const result = await runConfirmedJsonWrite(feedback, (options) => writeIndexedConfigEntity(write, options));
  if (!result) return null;
  const entity = indexedConfigEntityData(result);
  return { entity, receipt: result };
}

export async function createIndexedEntityAction(write: {
  baseVersions: import('@/shared/types').FileVersion[];
  sessionId: string;
  modRoot: string;
  kind: IndexedConfigKind;
  previousId: null;
  nextId: string;
  indexRow: RowData;
  entityData: RowData;
  deletePreviousTarget: false;
}): Promise<string> {
  const result = await writeCreateIndexedConfigEntity({ ...write, baseVersions: [] });
  const entity = indexedConfigEntityData(result);
  await completeConfigSave(write.modRoot, write.sessionId, result, indexedConfigHistoryLabel(write.kind, 'create', entity.entityId));
  return entity.entityId;
}

export async function deleteIndexedEntityAction(
  sessionId: string,
  modRoot: string,
  kind: IndexedConfigKind,
  id: string,
  deleteTarget: boolean,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<string> {
  const result = await writeDeleteIndexedConfigEntity({ sessionId, modRoot, kind, id, deleteTarget, baseVersions });
  await completeConfigSave(modRoot, sessionId, result, indexedConfigHistoryLabel(kind, 'delete', id));
  return indexedConfigEntityData(result).entityId;
}

export async function saveVariantAction(
  sessionId: string,
  modRoot: string,
  variantId: string,
  data: RowData,
  previousId: string | null,
  relPath: string,
  feedback?: AppFeedback,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<SavedConfig<VariantFile> | null> {
  const write = {
    baseVersions,
    sessionId,
    modRoot,
    previousId,
    nextId: variantId,
    data,
    relPath,
  };
  const result = await runConfirmedJsonWrite(feedback, (options) => writeVariantEntity(write, options));
  if (!result) return null;
  const variant = variantEntityData(result);
  return { entity: variant, receipt: result };
}

export async function createVariantAction(sessionId: string, modRoot: string, hullId: string, variantId: string): Promise<VariantFile> {
  const result = await writeCreateVariantEntity({
    baseVersions: [],
    sessionId,
    modRoot,
    previousId: null,
    relPath: null,
    nextId: variantId,
    data: createDefaultVariant(hullId, variantId),
  });
  const variant = variantEntityData(result);
  await completeConfigSave(modRoot, sessionId, result, `创建装配 ${variant.variantId}`);
  return variant;
}

export async function deleteVariantAction(
  sessionId: string,
  modRoot: string,
  relPath: string,
  variantId: string,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  const result = await writeDeleteVariantEntity({ sessionId, modRoot, relPath, entityId: variantId, baseVersions });
  await completeConfigSave(modRoot, sessionId, result, `删除装配 ${variantId}`);
  return result;
}

export async function saveSkinAction(
  sessionId: string,
  modRoot: string,
  skinHullId: string,
  data: RowData,
  previousId: string | null,
  relPath: string,
  feedback?: AppFeedback,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<SavedConfig<SkinFile> | null> {
  const write = {
    baseVersions,
    sessionId,
    modRoot,
    previousId,
    nextId: skinHullId,
    data,
    relPath,
  };
  const result = await runConfirmedJsonWrite(feedback, (options) => writeSkinEntity(write, options));
  if (!result) return null;
  const skin = skinEntityData(result);
  return { entity: skin, receipt: result };
}

export async function createSkinAction(sessionId: string, modRoot: string, baseHullId: string, skinHullId: string): Promise<SkinFile> {
  const result = await writeCreateSkinEntity({
    baseVersions: [],
    sessionId,
    modRoot,
    previousId: null,
    relPath: null,
    nextId: skinHullId,
    data: createDefaultSkin(baseHullId, skinHullId),
  });
  const skin = skinEntityData(result);
  await completeConfigSave(modRoot, sessionId, result, `创建舰船皮肤 ${skin.skinHullId}`);
  return skin;
}

export async function deleteSkinAction(
  sessionId: string,
  modRoot: string,
  relPath: string,
  skinHullId: string,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  const result = await writeDeleteSkinEntity({ sessionId, modRoot, relPath, entityId: skinHullId, baseVersions });
  await completeConfigSave(modRoot, sessionId, result, `删除舰船皮肤 ${skinHullId}`);
  return result;
}

export async function completeConfigSave(modRoot: string, sessionId: string, result: WriteResult, label: string) {
  if (result.changes.length === 0) return;
  await completeSavedWrite({ modRoot, sessionId, result, label }, useProjectStore());
}
