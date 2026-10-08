import type { FileChangeRecord } from '@/shared/types/history.types';
import type { RowData } from '@/shared/types/json.types';
import type { ProjectInvalidation } from '@/shared/types/query.types';
import type { FileHistorySnapshot } from '@/shared/types/file-history.types';

export interface FileVersion {
  path: string;
  fingerprint: string | null;
}

export interface CsvRowKeyMapping {
  previousKey: string;
  nextKey: string;
  rowIndex: number;
}

export interface WriteResult {
  changes: FileChangeRecord[];
  invalidation: ProjectInvalidation;
  keyMap: CsvRowKeyMapping[];
  refreshedEntity: RowData | null;
  commitId: number;
  baseVersions: FileVersion[];
  history: FileHistorySnapshot;
}

export interface JsonSourceConfirmation {
  path: string;
  sourceFingerprint: string;
}

export interface JsonWriteOptions {
  preserveOriginalJson: boolean;
  confirmedSources: JsonSourceConfirmation[];
}

export interface AssociatedFileChange {
  relPath: string;
  afterText: string | null;
  afterDataBase64: string | null;
}

export type AssociatedSpecChangeAction = 'create' | 'delete' | 'rename';

export type AssociatedSpecCreateParams =
  | { kind: 'ship'; id: string; hullName: string }
  | { kind: 'weapon'; id: string; specClass: import('@/shared/types/editor.types').WeaponSpecClass }
  | { kind: 'system'; id: string }
  | { kind: 'skill'; id: string };

export type AssociatedSpecChange =
  | { action: 'create'; create: AssociatedSpecCreateParams }
  | { action: 'delete'; id: string }
  | { action: 'rename'; previousId: string; create: AssociatedSpecCreateParams };

export type CsvRowPatchAction = 'upsert' | 'delete';

export interface CsvRowPatch {
  insertAt?: number;
  rowKey: string;
  action: CsvRowPatchAction;
  row: RowData;
}
