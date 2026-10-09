import type { AppFeedback, SavedConfig, IndexedConfigKind, ConfigFamilyFile, WriteResult } from '@/shared/types';
import type { RowData } from '@/shared/types';
import {
  createIndexedConfigEntity,
  createSkinEntity,
  createVariantEntity,
  deleteIndexedConfigEntity,
  deleteSkinEntity,
  deleteVariantEntity,
  saveIndexedConfigEntity,
  saveModInfo,
  saveSkinEntity,
  saveVariantEntity,
} from '@/services/config-entity.service';
import { createDefaultSkin, createDefaultVariant } from '@/domain/config/config-entities';
import { indexedConfigEntityData, configFamilyEntityData } from '@/domain/config/config-records';
import { completeSavedWrite } from '@/orchestrators/file-history-write.orchestrator';
import { retryPendingWritesForMod } from '@/orchestrators/project-session-refresh.orchestrator';
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
  await retryPendingWritesForMod(modRoot);
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
  await retryPendingWritesForMod(modRoot);
  const result = await runConfirmedJsonWrite(feedback, (options) => saveModInfo(sessionId, modRoot, data, options, baseVersions));
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
    runConfirmedJsonWrite(feedback, (options) => saveIndexedConfigEntity({ ...write, baseVersions: versions }, options)),
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
}): Promise<SavedConfig<import('@/shared/types').IndexedConfigEntityData>> {
  const baseVersions = await capturedVersions(write.sessionId, write.modRoot, write.kind, write.nextId, write.nextId, [], true);
  const result = await retainConfigReservation(createIndexedConfigEntity({ ...write, baseVersions }));
  const entity = indexedConfigEntityData(result);
  return { entity, receipt: result };
}

export async function deleteIndexedEntityAction(
  sessionId: string,
  modRoot: string,
  kind: IndexedConfigKind,
  id: string,
  deleteTarget: boolean,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  const result = await deleteIndexedConfigEntity({ sessionId, modRoot, kind, id, deleteTarget, baseVersions });
  return result;
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
  const result = await retainConfigReservation(runConfirmedJsonWrite(feedback, (options) => saveVariantEntity(write, options)));
  if (!result) return null;
  const variant = configFamilyEntityData(result);
  return { entity: variant, receipt: result };
}

export async function createVariantAction(
  sessionId: string,
  modRoot: string,
  hullId: string,
  variantId: string,
): Promise<SavedConfig<ConfigFamilyFile>> {
  const baseVersions = await capturedVersions(sessionId, modRoot, 'variant', variantId, variantId, [], true);
  const result = await retainConfigReservation(
    createVariantEntity({
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
  return { entity: variant, receipt: result };
}

export async function deleteVariantAction(
  sessionId: string,
  modRoot: string,
  relPath: string,
  variantId: string,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  const result = await deleteVariantEntity({ sessionId, modRoot, relPath, entityId: variantId, baseVersions });
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
  const result = await retainConfigReservation(runConfirmedJsonWrite(feedback, (options) => saveSkinEntity(write, options)));
  if (!result) return null;
  const skin = configFamilyEntityData(result);
  return { entity: skin, receipt: result };
}

export async function createSkinAction(
  sessionId: string,
  modRoot: string,
  baseHullId: string,
  skinHullId: string,
): Promise<SavedConfig<ConfigFamilyFile>> {
  const baseVersions = await capturedVersions(sessionId, modRoot, 'skin', skinHullId, skinHullId, [], true);
  const result = await retainConfigReservation(
    createSkinEntity({
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
  return { entity: skin, receipt: result };
}

export async function deleteSkinAction(
  sessionId: string,
  modRoot: string,
  relPath: string,
  skinHullId: string,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  const result = await deleteSkinEntity({ sessionId, modRoot, relPath, entityId: skinHullId, baseVersions });
  return result;
}

export async function completeConfigSave(modRoot: string, sessionId: string, result: WriteResult, label: string) {
  await releaseNativeWindowTargets();
  await completeSavedWrite({ modRoot, sessionId, result, label });
}
