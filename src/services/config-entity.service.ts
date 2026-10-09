import {
  querySessionEditorDraftResources,
  querySessionEntity,
  querySessionEntityList,
  querySessionEntityEditTarget,
  querySessionEntityIdentityIntent,
} from '@/services/entity-query.service';
import { hydrateFactionPreviewImages, hydrateMissionIcon } from '@/services/config-resource.service';
import {
  missionEditorDataFromEntity,
  toConfigFactionRecord,
  toConfigMissionRecord,
  toConfigFamilyRecord,
  type ConfigFactionPreviewImages,
} from '@/domain/config/config-records';
import type { ConfigMissionEditorData, ProjectSessionId, RowData } from '@/shared/types';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { invokeCommand } from '@/shared/runtime/command.runtime';
import type {
  DeleteIndexedConfigEntityWrite,
  DeleteSkinEntityWrite,
  DeleteVariantEntityWrite,
  IndexedConfigEntityWrite,
  JsonWriteOptions,
  SkinEntityWrite,
  VariantEntityWrite,
  WriteResult,
} from '@/shared/types';

export function saveModInfo(
  sessionId: string,
  modRoot: string,
  data: RowData,
  jsonWrite: JsonWriteOptions,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  return invokeCommand('save_mod_info', {
    payload: { baseVersions, sessionId, modRoot, data, jsonWrite, orderedJson: JSON.stringify(data) },
  });
}

export function saveIndexedConfigEntity(write: IndexedConfigEntityWrite, jsonWrite?: JsonWriteOptions): Promise<WriteResult> {
  return invokeCommand('save_indexed_config_entity', {
    payload: {
      modRoot: write.modRoot,
      baseVersions: write.baseVersions,
      sessionId: write.sessionId,
      kind: write.kind,
      previousId: write.previousId,
      nextId: write.nextId,
      indexRow: write.indexRow,
      entityData: write.entityData,
      ...(jsonWrite
        ? { jsonWrite, orderedJson: JSON.stringify(write.kind === 'faction' ? write.entityData.file : write.entityData.descriptor) }
        : {}),
    },
  });
}

export function createIndexedConfigEntity(write: IndexedConfigEntityWrite): Promise<WriteResult> {
  return invokeCommand('create_indexed_config_entity', { payload: { ...write } });
}

export function deleteIndexedConfigEntity(write: DeleteIndexedConfigEntityWrite): Promise<WriteResult> {
  return invokeCommand('delete_indexed_config_entity', { payload: write });
}

export function saveVariantEntity(write: VariantEntityWrite, jsonWrite?: JsonWriteOptions): Promise<WriteResult> {
  return invokeCommand('save_variant_entity', {
    payload: { ...write, ...(jsonWrite ? { jsonWrite, orderedJson: JSON.stringify(write.data) } : {}) },
  });
}

export function createVariantEntity(write: VariantEntityWrite): Promise<WriteResult> {
  return invokeCommand('create_variant_entity', { payload: write });
}

export function deleteVariantEntity(write: DeleteVariantEntityWrite): Promise<WriteResult> {
  return invokeCommand('delete_variant_entity', { payload: write });
}

export function saveSkinEntity(write: SkinEntityWrite, jsonWrite?: JsonWriteOptions): Promise<WriteResult> {
  return invokeCommand('save_skin_entity', {
    payload: { ...write, ...(jsonWrite ? { jsonWrite, orderedJson: JSON.stringify(write.data) } : {}) },
  });
}

export function createSkinEntity(write: SkinEntityWrite): Promise<WriteResult> {
  return invokeCommand('create_skin_entity', { payload: write });
}

export function deleteSkinEntity(write: DeleteSkinEntityWrite): Promise<WriteResult> {
  return invokeCommand('delete_skin_entity', { payload: write });
}

export async function captureConfigIdentityIntent(
  sessionId: string,
  kind: import('@/shared/types').EntityKind,
  sourceId: string,
  nextId: string,
) {
  const info = cloneQuerySnapshot<import('@/shared/types').EntityEditInfo>(await querySessionEntityEditTarget(sessionId, kind, sourceId));
  const intent = await querySessionEntityIdentityIntent(sessionId, info.target, nextId);
  return { info, intent: cloneQuerySnapshot<import('@/shared/types').EntityIdentityIntent>(intent) };
}

/**
 * Read service for config entities: the only wrapper around config entity queries
 * (the app layer must not call querySession* directly). Record shaping is delegated
 * to domain/config/config-records; write payloads belong to this capability and
 * save orchestration owns confirmation, identity reservation and receipt acceptance.
 */
export async function listConfigFactionRecords(sessionId: ProjectSessionId, signal?: AbortSignal) {
  const entities = await querySessionEntityList(sessionId, 'faction', signal);
  return entities.map(toConfigFactionRecord);
}

export async function listConfigMissionRecords(sessionId: ProjectSessionId, signal?: AbortSignal) {
  const entities = await querySessionEntityList(sessionId, 'mission', signal);
  return entities.map(toConfigMissionRecord);
}

export async function listVariantRecords(sessionId: ProjectSessionId, signal?: AbortSignal) {
  const entities = await querySessionEntityList(sessionId, 'variant', signal);
  return entities.map(toConfigFamilyRecord);
}

export async function getConfigFamilyRecord(sessionId: string, kind: 'variant' | 'skin', id: string, signal?: AbortSignal) {
  const entity = await querySessionEntity(sessionId, kind, id, signal);
  return entity ? toConfigFamilyRecord(entity) : null;
}
export async function getConfigFactionRecord(sessionId: string, id: string, signal?: AbortSignal) {
  const entity = await querySessionEntity(sessionId, 'faction', id, signal);
  return entity ? toConfigFactionRecord(entity) : null;
}

export async function listSkinRecords(sessionId: ProjectSessionId, signal?: AbortSignal) {
  const entities = await querySessionEntityList(sessionId, 'skin', signal);
  return entities.map(toConfigFamilyRecord);
}

export async function queryFactionPreviewImages(
  sessionId: ProjectSessionId,
  id: string,
  draft: RowData,
  signal?: AbortSignal,
): Promise<ConfigFactionPreviewImages> {
  const resources = await querySessionEditorDraftResources(sessionId, 'faction', id, draft, signal);
  return hydrateFactionPreviewImages(sessionId, resources, signal);
}

export async function queryMissionDraftIcon(
  sessionId: ProjectSessionId,
  id: string,
  draft: RowData,
  signal?: AbortSignal,
): Promise<string> {
  const resources = await querySessionEditorDraftResources(sessionId, 'mission', id, draft, signal);
  return hydrateMissionIcon(sessionId, resources.icon ?? null, signal);
}

export async function getConfigMissionEditorData(
  sessionId: ProjectSessionId,
  id: string,
  signal?: AbortSignal,
): Promise<ConfigMissionEditorData | null> {
  const entity = await querySessionEntity(sessionId, 'mission', id, signal);
  if (!entity) return null;
  const iconSrc = await hydrateMissionIcon(sessionId, entity.resourceRefs.icon ?? null, signal);
  return missionEditorDataFromEntity(entity, iconSrc);
}
