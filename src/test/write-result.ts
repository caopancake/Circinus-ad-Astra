import type { RowData, WriteResult } from '@/shared/types';

export function savedWriteFixture(refreshedEntity: RowData | null = null): WriteResult {
  return {
    baseVersions: [],
    commitId: 1,
    history: { revision: 1, undoStack: [], redoStack: [] },
    changes: [],
    invalidation: { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false },
    keyMap: [],
    refreshedEntity,
  };
}
