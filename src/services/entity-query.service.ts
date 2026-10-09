import { invokeCommand } from '@/shared/runtime/command.runtime';
import { queryCached, queryLive } from '@/services/query-cache.service';
import type { EntityKind, EntityEditTarget, EditorResourceKind, RowData } from '@/shared/types';
import type { QueryValue } from '@/shared/types';

export function querySessionEntity(
  sessionId: string,
  kind: EntityKind,
  id: string,
  signal?: AbortSignal,
): Promise<QueryValue<'entity-detail'>> {
  const parameters = { kind, id };
  return queryCached(
    { sessionId, queryKind: 'entity-detail', parameters },
    () => invokeCommand('query_entity', { payload: { sessionId, ...parameters } }),
    signal,
  );
}

export function querySessionEntityList(sessionId: string, kind: EntityKind, signal?: AbortSignal): Promise<QueryValue<'entity-list'>> {
  return queryCached(
    { sessionId, queryKind: 'entity-list', parameters: { kind } },
    () => invokeCommand('query_entity_list', { payload: { sessionId, kind } }),
    signal,
  );
}

export function querySessionEntityEditTarget(
  sessionId: string,
  kind: EntityKind,
  id: string,
  signal?: AbortSignal,
): Promise<QueryValue<'entity-edit-target'>> {
  return queryLive(
    { sessionId, queryKind: 'entity-edit-target', parameters: { kind, id } },
    () => invokeCommand('query_entity_edit_target', { payload: { sessionId, kind, id } }),
    signal,
  );
}

export function querySessionEntityIdentityIntent(
  sessionId: string,
  source: EntityEditTarget,
  nextId: string,
  signal?: AbortSignal,
): Promise<QueryValue<'entity-identity-intent'>> {
  const parameters = { source, nextId };
  return queryLive(
    { sessionId, queryKind: 'entity-identity-intent', parameters },
    () => invokeCommand('query_entity_identity_intent', { payload: { sessionId, ...parameters } }),
    signal,
  );
}

export function querySessionEditorDraftResources(
  sessionId: string,
  kind: EditorResourceKind,
  id: string,
  draft: RowData,
  signal?: AbortSignal,
): Promise<QueryValue<'editor-draft-resources'>> {
  const parameters = { kind, id, draft };
  return queryLive<'editor-draft-resources'>(
    { sessionId, queryKind: 'editor-draft-resources', parameters },
    () => invokeCommand('query_editor_draft_resources', { payload: { sessionId, ...parameters } }),
    signal,
  );
}
