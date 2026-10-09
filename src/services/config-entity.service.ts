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
 * to domain/config/config-records; write paths belong to write.service and the
 * config-save orchestration, never to this service.
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
