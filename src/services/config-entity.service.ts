import { querySessionEditorDraftResources, querySessionEntity, querySessionEntityList } from '@/services/query.service';
import { hydrateFactionPreviewImages, hydrateMissionIcon } from '@/services/config-resource.service';
import {
  missionEditorDataFromEntity,
  toConfigFactionRecord,
  toConfigMissionRecord,
  toConfigSkinRecord,
  toConfigVariantRecord,
  type ConfigFactionPreviewImages,
} from '@/domain/config/config-records';
import type { ConfigMissionEditorData, ProjectSessionId, RowData } from '@/shared/types';

/**
 * Read service for config entities: the only wrapper around config entity queries
 * (the app layer must not call querySession* directly). Record shaping is delegated
 * to domain/config/config-records; write paths belong to write.service and the
 * config-save orchestration, never to this service.
 */
export async function listConfigFactionRecords(sessionId: ProjectSessionId) {
  const entities = await querySessionEntityList(sessionId, 'faction');
  return entities.map(toConfigFactionRecord);
}

export async function listConfigMissionRecords(sessionId: ProjectSessionId) {
  const entities = await querySessionEntityList(sessionId, 'mission');
  return entities.map(toConfigMissionRecord);
}

export async function listVariantRecords(sessionId: ProjectSessionId) {
  const entities = await querySessionEntityList(sessionId, 'variant');
  return entities.map(toConfigVariantRecord);
}

export async function listSkinRecords(sessionId: ProjectSessionId) {
  const entities = await querySessionEntityList(sessionId, 'skin');
  return entities.map(toConfigSkinRecord);
}

export async function queryFactionPreviewImages(
  sessionId: ProjectSessionId,
  id: string,
  draft: RowData,
): Promise<ConfigFactionPreviewImages> {
  const resources = await querySessionEditorDraftResources(sessionId, 'faction', id, draft);
  return hydrateFactionPreviewImages(sessionId, resources);
}

export async function queryMissionDraftIcon(sessionId: ProjectSessionId, id: string, draft: RowData): Promise<string> {
  const resources = await querySessionEditorDraftResources(sessionId, 'mission', id, draft);
  return hydrateMissionIcon(sessionId, resources.icon ?? null);
}

export async function getConfigMissionEditorData(sessionId: ProjectSessionId, id: string): Promise<ConfigMissionEditorData | null> {
  const entity = await querySessionEntity(sessionId, 'mission', id);
  if (!entity) return null;
  const iconSrc = await hydrateMissionIcon(sessionId, entity.resourceRefs.icon ?? null);
  return missionEditorDataFromEntity(entity, iconSrc);
}
