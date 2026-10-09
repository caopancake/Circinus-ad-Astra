import {
  TABLE_KEYS,
  type TableKey,
  type TableSummary,
  type RowData,
  type WriteResult,
  type CommittedSessionUpdate,
  type ProjectManifest,
} from '@/shared/types';

export function sessionUpdateFixture(sessionId: string, modRoot: string, commitId = 1): CommittedSessionUpdate {
  const tableSummaries = Object.fromEntries(
    TABLE_KEYS.map((key): [TableKey, TableSummary] => [key, { path: key + '.csv', header: [], available: false, totalRows: 0 }]),
  ) as ProjectManifest['tableSummaries'];
  const tableEntitySummaries = Object.fromEntries(TABLE_KEYS.map((key) => [key, 0])) as ProjectManifest['tableEntitySummaries'];
  return {
    sessionId,
    modRoot,
    commitId,
    status: 'ready',
    projection: {
      projectionRevision: commitId,
      manifest: {
        sessionId,
        modRoot,
        baseVersions: [],
        starsectorRoot: null,
        coreAvailable: false,
        associatedSpecTables: [],
        modInfo: null,
        warnings: [],
        tableSummaries,
        tableEntitySummaries,
        entitySummaries: { ships: 0, weapons: 0, projectiles: 0, variants: 0, skins: 0, systems: 0, skills: 0, factions: 0, missions: 0 },
      },
      invalidation: { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false },
    },
  };
}

export function savedWriteFixture(refreshedEntity: RowData | null = null): WriteResult {
  return {
    sessionUpdates: [],
    baseVersions: [],
    commitId: 1,
    history: { revision: 1, undoStack: [], redoStack: [] },
    changes: [],
    invalidation: { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false },
    identityChanges: [],
    keyMap: [],
    refreshedEntity,
  };
}
