import {
  WINDOW_EVENTS,
  type EntityTablePrepareEvent,
  type EntityTablePreparedEvent,
  type EntityTableReleaseEvent,
} from '@/windows/window.events';
import { emitWindowEvent, listenWindowEvent } from '@/windows/tauri.events';
import { currentWindowLabel } from '@/windows/current.window';
import { publishCurrentWindowIdentity } from '@/windows/window-identity.window';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';
import { saveTableChanges } from '@/orchestrators/table-save.orchestrator';
import { applyCommittedWriteCacheInvalid } from '@/orchestrators/project-session-refresh.orchestrator';
import { useTablesStore } from '@/stores/tables.store';
import { useProjectStore } from '@/stores/project.store';
import { useTablesEditHistoryStore } from '@/stores/tables-edit-history.store';
import { queryEditorIdentityIntent } from '@/services/editor.service';
import { querySessionEntityEditTarget } from '@/services/entity-query.service';
import { reserveNativeWindowTargets, releaseNativeWindowTargets, retargetNativeWindow } from '@/services/window.service';
import { focusEntityIdentityConflict } from '@/orchestrators/window-target-focus.orchestrator';
import { editorWindowTitle } from '@/domain/editors/editor-definitions';
import { AppError, formatError } from '@/shared/lib/errors';
import { isReadInvalidated } from '@/shared/runtime/read-request';
import type {
  AppFeedback,
  AssociatedSpecChange,
  EntityEditInfo,
  EntityEditTarget,
  EditorSpecKind,
  EditorWindowKind,
  RowData,
  WriteResult,
  WindowIdentity,
} from '@/shared/types';
import type { AssociatedSpecCandidate } from '@/domain/tables/associated-spec-candidates';
import { deepClone } from '@/shared/lib/starsector';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';

export async function retargetEntityWindow(sessionId: string, modRoot: string, kind: EditorWindowKind, id: string) {
  const identity: WindowIdentity = { type: 'spec', sessionId, modRoot, kind, id };
  await retargetNativeWindow(identity, editorWindowTitle(kind, id));
  publishCurrentWindowIdentity(identity);
}

export function releaseCommittedIdentityTargets() {
  return releaseNativeWindowTargets();
}

export async function reserveEntityIntent(sessionId: string, modRoot: string, source: EntityEditTarget, draft: RowData) {
  const intent = await queryEditorIdentityIntent(sessionId, source, draft).catch(async (error) => {
    await focusEntityIdentityConflict(sessionId, modRoot, error);
    throw error;
  });
  const kind = source.kind as EditorSpecKind;
  const identities: WindowIdentity[] = [
    { type: 'spec', sessionId, modRoot, kind, id: intent.nextId },
    { type: 'file', sessionId, modRoot, path: intent.nextWrite.path },
  ];
  if (source.state === 'create' || source.id !== intent.nextId || source.write.path !== intent.nextWrite.path)
    await reserveNativeWindowTargets(identities);
  return intent;
}

export async function reserveFileIdentityIntent(sessionId: string, modRoot: string, intent: import('@/shared/types').EntityIdentityIntent) {
  if (intent.source.id === intent.nextId && intent.source.write.path === intent.nextWrite.path) return;
  const identities: WindowIdentity[] = [{ type: 'file', sessionId, modRoot, path: intent.nextWrite.path }];
  if (['ship', 'weapon', 'projectile', 'system'].includes(intent.source.kind))
    identities.push({ type: 'spec', sessionId, modRoot, kind: intent.source.kind as EditorSpecKind, id: intent.nextId });
  await reserveNativeWindowTargets(identities);
}
export async function retargetFileWindow(sessionId: string, modRoot: string, path: string, title: string) {
  const identity: WindowIdentity = { type: 'file', sessionId, modRoot, path };
  await retargetNativeWindow(identity, title);
  publishCurrentWindowIdentity(identity);
}

export async function createEntitySavePreparation() {
  const waiting = new Map<string, { resolve: (reply: EntityTablePreparedEvent) => void; request: EntityTablePrepareEvent }>();
  const stop = await listenWindowEvent<EntityTablePreparedEvent>(
    WINDOW_EVENTS.entityTablePrepared,
    (reply) => {
      const pending = waiting.get(reply.requestId);
      const matches =
        pending &&
        reply.ownerLabel === pending.request.ownerLabel &&
        reply.sessionId === pending.request.sessionId &&
        reply.modRoot === pending.request.modRoot &&
        reply.source.id === pending.request.source.id &&
        reply.source.write.path === pending.request.source.write.path;
      if (!matches) return;
      pending.resolve(reply);
    },
    recordWindowEventHandlerError,
  );
  let disposed = false;
  let activeRequest: EntityTablePrepareEvent | null = null;

  async function prepare<T>(
    sessionId: string,
    modRoot: string,
    source: EntityEditTarget,
    submit: (info: EntityEditInfo | null, receipt: WriteResult | null) => Promise<T | null>,
  ): Promise<T | null> {
    const ownerLabel = currentWindowLabel();
    const request: EntityTablePrepareEvent = { requestId: crypto.randomUUID(), ownerLabel, sessionId, modRoot, source: deepClone(source) };
    let info: EntityEditInfo | null = null;
    let receipt: WriteResult | null = null;
    if (source.linkedRecord?.kind === 'csv') {
      activeRequest = request;
      const reply = new Promise<EntityTablePreparedEvent>((resolve) => waiting.set(request.requestId, { resolve, request }));
      await emitWindowEvent(WINDOW_EVENTS.entityTablePrepare, request);
      const result = await reply;
      waiting.delete(request.requestId);
      if (result.status === 'cancelled' || disposed) return null;
      if (result.status === 'failed') throw new AppError(result.message, { action: 'prepare-entity-table' });
      info = result.info;
      receipt = result.receipt;
    }
    return submit(info, receipt);
  }
  async function finish(receipt: WriteResult | null) {
    if (!activeRequest) return;
    const request = activeRequest;
    await emitWindowEvent(WINDOW_EVENTS.entityTableRelease, { ...request, receipt } satisfies EntityTableReleaseEvent);
    activeRequest = null;
  }
  async function withPreparation<T>(
    sessionId: string,
    modRoot: string,
    source: EntityEditTarget,
    submit: (info: EntityEditInfo | null, receipt: WriteResult | null) => Promise<T | null>,
  ): Promise<T | null> {
    try {
      return await prepare(sessionId, modRoot, source, submit);
    } finally {
      try {
        await finish(null);
      } finally {
        await releaseNativeWindowTargets();
      }
    }
  }
  function dispose() {
    if (activeRequest) void finish(null).catch((error) => recordWindowEventHandlerError(error, WINDOW_EVENTS.entityTableRelease));
    void releaseNativeWindowTargets().catch((error) => recordWindowEventHandlerError(error, WINDOW_EVENTS.entityTableRelease));
    disposed = true;
    stop();
    for (const pending of waiting.values()) pending.resolve({ ...pending.request, status: 'cancelled' });
    waiting.clear();
  }
  return { withPreparation, finish, dispose };
}

export async function listenEntityTablePreparation(
  feedback: AppFeedback,
  selectAssociatedSpecs: (candidates: AssociatedSpecCandidate[]) => Promise<AssociatedSpecChange[] | null>,
) {
  const tables = useTablesStore();
  const project = useProjectStore();
  const requests = new Map<string, EntityTablePrepareEvent>();
  let disposed = false;
  const stops: Array<() => void> = [];
  stops.push(
    await listenWindowEvent<EntityTablePrepareEvent>(
      WINDOW_EVENTS.entityTablePrepare,
      async (request) => {
        const linked = request.source.linkedRecord;
        if (linked?.kind !== 'csv') return;
        requests.set(request.requestId, request);
        let response: EntityTablePreparedEvent;
        try {
          const manifest = project.getManifest(request.modRoot);
          if (manifest?.sessionId !== request.sessionId) throw new AppError('所属 Mod 会话已关闭', { action: 'prepare-entity-table' });
          if (tables.isTableLocked(request.modRoot, linked.table))
            throw new AppError('所属 CSV 正在交接身份', { action: 'prepare-entity-table' });
          const saved = await saveTableChanges({ manifest, table: linked.table, feedback, selectAssociatedSpecs });
          if (saved.status === 'cancelled' || disposed || !requests.has(request.requestId)) response = { ...request, status: 'cancelled' };
          else {
            const state = tables.getModTableState(request.modRoot)!;
            if (Object.keys(state.dirty[linked.table]).length > 0 || tables.getTableInputs(request.modRoot, linked.table).dirty.value)
              throw new AppError('所属 CSV 在保存期间继续编辑，请完成该表保存后重试', { action: 'prepare-entity-table' });
            if (tables.isTableLocked(request.modRoot, linked.table))
              throw new AppError('所属 CSV 正在交接身份', { action: 'prepare-entity-table' });
            tables.lockTable({ sessionId: request.sessionId, modRoot: request.modRoot, table: linked.table }, request.requestId);
            tables.revokeTableReads(request.modRoot, linked.table);
            const identity =
              saved.status === 'saved'
                ? saved.receipt.identityChanges.find(
                    (change) => change.before.kind === request.source.kind && change.before.id === request.source.id,
                  )
                : null;
            const source = identity?.after ?? request.source;
            const info = cloneQuerySnapshot<EntityEditInfo>(await querySessionEntityEditTarget(request.sessionId, source.kind, source.id));
            if (info.target.id !== source.id || info.target.state !== source.state || info.target.write.path !== source.write.path) {
              throw new AppError('规格目标在表格准备期间发生变化，请接纳外部身份后重试', { action: 'prepare-entity-table' });
            }
            if (disposed || !requests.has(request.requestId)) response = { ...request, status: 'cancelled' };
            else {
              response = { ...request, status: 'ready', info, receipt: saved.status === 'saved' ? saved.receipt : null };
            }
          }
        } catch (error) {
          response = isReadInvalidated(error)
            ? { ...request, status: 'cancelled' }
            : { ...request, status: 'failed', message: formatError(error) };
        }
        if (response.status !== 'ready') {
          requests.delete(request.requestId);
          tables.releaseTableLock(request.requestId);
        }
        try {
          await emitWindowEvent(WINDOW_EVENTS.entityTablePrepared, response);
        } catch (error) {
          requests.delete(request.requestId);
          tables.releaseTableLock(request.requestId);
          throw error;
        }
      },
      recordWindowEventHandlerError,
    ),
  );
  stops.push(
    await listenWindowEvent<EntityTableReleaseEvent>(
      WINDOW_EVENTS.entityTableRelease,
      (event) => {
        const request = requests.get(event.requestId);
        const sameRequest =
          request && request.ownerLabel === event.ownerLabel && request.sessionId === event.sessionId && request.modRoot === event.modRoot;
        if (!sameRequest) return;
        if (event.receipt) adoptTableIdentityResult(request, event.receipt);
        requests.delete(event.requestId);
        tables.releaseTableLock(event.requestId);
      },
      recordWindowEventHandlerError,
    ),
  );
  stops.push(
    await listenWindowEvent<{ label: string }>(
      WINDOW_EVENTS.managedWindowReleased,
      ({ label }) => {
        for (const request of requests.values()) {
          if (request.ownerLabel === label) {
            requests.delete(request.requestId);
            tables.releaseTableLock(request.requestId);
          }
        }
      },
      recordWindowEventHandlerError,
    ),
  );
  return () => {
    disposed = true;
    stops.forEach((stop) => stop());
    for (const request of requests.values()) {
      tables.releaseTableLock(request.requestId);
      void emitWindowEvent(WINDOW_EVENTS.entityTablePrepared, { ...request, status: 'cancelled' } satisfies EntityTablePreparedEvent).catch(
        (error) => recordWindowEventHandlerError(error, WINDOW_EVENTS.entityTablePrepared),
      );
    }
    requests.clear();
  };
}

function adoptTableIdentityResult(request: EntityTablePrepareEvent, receipt: WriteResult) {
  if (useProjectStore().getSessionId(request.modRoot) !== request.sessionId) return;
  const tables = useTablesStore();
  const state = tables.getModTableState(request.modRoot);
  const linked = request.source.linkedRecord;
  if (!state || linked?.kind !== 'csv') return;
  for (const change of receipt.identityChanges) {
    const record = change.before.linkedRecord;
    if (record?.kind !== 'csv' || record.table !== linked.table) continue;
    for (const rows of [state.tables[record.table], state.originalTables[record.table]]) {
      const row = rows.find((row) => row?.rowKey === record.rowKey);
      if (row) row.data.id = change.after.id;
    }
    state.baseVersions[record.table] = receipt.baseVersions.filter((version) => version.path.toLowerCase().endsWith('.csv'));
    useTablesEditHistoryStore().clearCsvEditHistory(request.modRoot, record.table);
  }
  tables.revokeTableReads(request.modRoot, linked.table);
  applyCommittedWriteCacheInvalid(request.sessionId, receipt);
}
