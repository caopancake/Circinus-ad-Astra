import type { GameModSummary, GameScanWarning } from '@/shared/types/query.types';
import type { CsvDirtyRow, CsvFactionFilter, CsvTableRows, TableKey } from '@/shared/types/tables.types';
import type { CsvCellTarget } from '@/shared/types/tables.types';

export type WorkspaceColumnWidths = Record<string, Partial<Record<TableKey, Record<string, number>>>>;

/** Metadata for one imported Mod in the workspace */
export interface ModEntry {
  modRoot: string;
  displayName: string;
  version: string;
  status: 'loading' | 'ready' | 'error';
  error?: string;
}

export interface ModOpeningFailureFile {
  path: string;
  line?: number;
  column?: number;
}

export interface ModOpeningFailure {
  modRoot: string;
  message: string;
  diagnostic: import('@/shared/types/error.types').ErrorDiagnostic;
  file: ModOpeningFailureFile | null;
}

/** Per-Mod table state — fully isolated from other Mods */
export interface ModTableState {
  baseVersions: Record<TableKey, import('@/shared/types/write.types').FileVersion[]>;
  tables: Record<TableKey, CsvTableRows>;
  originalTables: Record<TableKey, CsvTableRows>;
  headers: Record<TableKey, string[]>;
  totalRows: Record<TableKey, number>;
  filteredRows: Record<TableKey, number>;
  dirty: Record<TableKey, Record<string, CsvDirtyRow>>;
  pendingExternalTableUpdates: Record<TableKey, boolean>;
  currentTab: TableKey;
  currentFaction: CsvFactionFilter;
  searchText: string;
  selectedRowKey: string | null;
  editing: CsvCellTarget | null;
  nextRowKey: number; // Per-mod row key counter to prevent collisions
}

/** Which main-content view is shown */
export type WorkspaceView = 'overview' | 'table' | 'settings' | 'config' | 'about';

/** Which config sub-view is shown when currentView === 'config' */
export type ConfigView = 'mod-overview' | 'file-history' | 'mod-info' | 'factions' | 'skins' | 'variants' | 'mission';

/** Persisted mod entry (stored to disk) */
export interface PersistedMod {
  modRoot: string;
  displayName: string;
  version: string;
}

/** Persisted workspace state (stored to disk via Rust backend) */
export interface PersistedWorkspace {
  mods: PersistedMod[];
  starsectorRoot: string | null;
  gameMods: GameModSummary[];
  gameWarnings: GameScanWarning[];
  columnWidths: WorkspaceColumnWidths;
}
