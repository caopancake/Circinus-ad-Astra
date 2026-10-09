import type { AppFeedback, SavedConfig, IndexedConfigKind, ConfigFamilyFile, WriteResult } from '@/shared/types';
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
import { indexedConfigEntityData, configFamilyEntityData } from '@/domain/config/config-records';
import { useProjectStore } from '@/stores/project.store';
import { completeSavedWrite } from '@/orchestrators/file-history-write.orchestrator';
import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';
import { captureConfigIdentityIntent } from '@/services/config-entity.service';
import { reserveFileIdentityIntent } from '@/orchestrators/entity-identity.orchestrator';
import { releaseNativeWindowTargets } from '@/services/window.service';
import { captureIdentityVersions } from '@/domain/editors/entity-identity';

async function capturedVersions(
  sessionId: string,
  modRoot: string,
  kind: import('@/shared/types').EntityKind,
  sourceId: string,
  nextId: string,
  baseVersions: import('@/shared/types').FileVersion[],
  create = false,
) {
  const captured = await captureConfigIdentityIntent(sessionId, kind, sourceId, nextId);
  await reserveFileIdentityIntent(sessionId, modRoot, captured.intent);
  const versions = create ? captured.info.baseVersions : baseVersions;
  return captureIdentityVersions(versions, captured.intent.destinationVersion);
}

async function retainConfigReservation<T>(write: Promise<T>): Promise<T> {
  try {
    const result = await write;
    if (result === null) await releaseNativeWindowTargets();
    return result;
  } catch (error) {
    await releaseNativeWindowTargets();
    throw error;
  }
}

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
  },
  feedback?: AppFeedback,
): Promise<SavedConfig<import('@/shared/types').IndexedConfigEntityData> | null> {
  const versions = await capturedVersions(
    write.sessionId,
    write.modRoot,
    write.kind,
    write.previousId ?? write.nextId,
    write.nextId,
    write.baseVersions,
  );
  const result = await retainConfigReservation(
    runConfirmedJsonWrite(feedback, (options) => writeIndexedConfigEntity({ ...write, baseVersions: versions }, options)),
  );
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
}): Promise<string> {
  const baseVersions = await capturedVersions(write.sessionId, write.modRoot, write.kind, write.nextId, write.nextId, [], true);
  const result = await retainConfigReservation(writeCreateIndexedConfigEntity({ ...write, baseVersions }));
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
): Promise<SavedConfig<ConfigFamilyFile> | null> {
  baseVersions = await capturedVersions(sessionId, modRoot, 'variant', previousId ?? variantId, variantId, baseVersions);
  const write = {
    baseVersions,
    sessionId,
    modRoot,
    previousId,
    nextId: variantId,
    data,
    relPath,
  };
  const result = await retainConfigReservation(runConfirmedJsonWrite(feedback, (options) => writeVariantEntity(write, options)));
  if (!result) return null;
  const variant = configFamilyEntityData(result);
  return { entity: variant, receipt: result };
}

export async function createVariantAction(
  sessionId: string,
  modRoot: string,
  hullId: string,
  variantId: string,
): Promise<ConfigFamilyFile> {
  const baseVersions = await capturedVersions(sessionId, modRoot, 'variant', variantId, variantId, [], true);
  const result = await retainConfigReservation(
    writeCreateVariantEntity({
      baseVersions,
      sessionId,
      modRoot,
      previousId: null,
      relPath: null,
      nextId: variantId,
      data: createDefaultVariant(hullId, variantId),
    }),
  );
  const variant = configFamilyEntityData(result);
  await completeConfigSave(modRoot, sessionId, result, `创建装配 ${variant.id}`);
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
): Promise<SavedConfig<ConfigFamilyFile> | null> {
  baseVersions = await capturedVersions(sessionId, modRoot, 'skin', previousId ?? skinHullId, skinHullId, baseVersions);
  const write = {
    baseVersions,
    sessionId,
    modRoot,
    previousId,
    nextId: skinHullId,
    data,
    relPath,
  };
  const result = await retainConfigReservation(runConfirmedJsonWrite(feedback, (options) => writeSkinEntity(write, options)));
  if (!result) return null;
  const skin = configFamilyEntityData(result);
  return { entity: skin, receipt: result };
}

export async function createSkinAction(
  sessionId: string,
  modRoot: string,
  baseHullId: string,
  skinHullId: string,
): Promise<ConfigFamilyFile> {
  const baseVersions = await capturedVersions(sessionId, modRoot, 'skin', skinHullId, skinHullId, [], true);
  const result = await retainConfigReservation(
    writeCreateSkinEntity({
      baseVersions,
      sessionId,
      modRoot,
      previousId: null,
      relPath: null,
      nextId: skinHullId,
      data: createDefaultSkin(baseHullId, skinHullId),
    }),
  );
  const skin = configFamilyEntityData(result);
  await completeConfigSave(modRoot, sessionId, result, `创建舰船皮肤 ${skin.id}`);
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
  await releaseNativeWindowTargets();
  if (result.changes.length > 0) await completeSavedWrite({ modRoot, sessionId, result, label }, useProjectStore());
}
