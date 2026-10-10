export type { JsonInputShape, JsonInputValue, JsonValue, RowData } from '@/shared/types/json.types';
export type { EditContext } from '@/shared/types/edit-context.types';
export type {
  DeepReadonly,
  ReadonlyJsonValue,
  QueryIdentity,
  QueryKind,
  QueryCacheKind,
  QueryParameters,
  QueryResults,
  QueryValue,
} from '@/shared/types/query-cache.types';
export type { ErrorDiagnostic, ErrorLocation, FeedbackNotice } from '@/shared/types/error.types';
export type {
  EntityEditTarget,
  EntityEditInfo,
  EntityFileLocation,
  EntityLinkedRecord,
  EntityIdentityChange,
  EntityIdentityIntent,
} from '@/shared/types/entity-target.types';
export type {
  WindowIdentity,
  WindowCloseIntent,
  NativeWindowRequest,
  ManagedWindowOpened,
  ManagedWindowStatus,
} from '@/shared/types/window.types';
export type { CreatedMod, CreateModRequest, NewModDestination, NewModTemplate } from '@/shared/types/mod-creation.types';
export type { AccentPreset, AppSettings, AppTheme, EditMode, LogLevel } from '@/shared/types/settings.types';
export { ACCENT_PRESET_VALUES, APP_THEMES, EDIT_MODES, LOG_LEVELS } from '@/shared/types/settings.types';
export type { AppLogEntry, AppLogLevel, AppLogStatus } from '@/shared/types/app-log.types';
export { APP_LOG_LEVELS } from '@/shared/types/app-log.types';
export type { FileChangeKind, FileChangeRecord, FileChangeReplayDirection, FileSnapshot } from '@/shared/types/history.types';
export type { CsvDraftOperation, CsvEditHistoryEntry } from '@/shared/types/tables-edit-history.types';
export type { FileHistoryItem, FileSaveHistoryEntry, FileHistorySnapshot } from '@/shared/types/file-history.types';
export type {
  AssociatedFileChange,
  AssociatedSpecChange,
  AssociatedSpecWrite,
  AssociatedSpecCreateParams,
  AssociatedSpecChangeAction,
  CsvRowKeyMapping,
  CsvRowPatch,
  CsvRowPatchAction,
  JsonSourceConfirmation,
  JsonWriteOptions,
  WriteResult,
  CommittedSessionUpdate,
  CommittedWriteEvent,
  FileVersion,
} from '@/shared/types/write.types';
export type {
  ConfigFileEntityWrite,
  ConfigFamilyFile,
  ConfigSaveIdentity,
  ConfigIdentityHandoff,
  SavedConfig,
  ConfigEditTarget,
  ConfigMissionEditorData,
  DeleteIndexedConfigEntityWrite,
  DeleteSkinEntityWrite,
  DeleteVariantEntityWrite,
  IndexedConfigEntityData,
  IndexedConfigKind,
  IndexedConfigEntityWrite,
  SkinEntityWrite,
  VariantEntityWrite,
} from '@/shared/types/config-entity.types';
export type {
  CsvDirtyRow,
  CsvDraftRow,
  CsvRow,
  CsvRowRecord,
  CsvCellTarget,
  CsvTableTarget,
  CsvSearchField,
  CsvGridRowSlot,
  CsvLoadedRowSlot,
  CsvPlaceholderRowSlot,
  CsvRowPreview,
  CsvRowPreviewTarget,
  CsvTableRows,
  CsvTableWindow,
  CsvWindowRow,
  TableKey,
} from '@/shared/types/tables.types';
export { TABLE_KEYS } from '@/shared/types/tables.types';
export type {
  DiscoveredField,
  DiscoveredFieldType,
  EntityData,
  EntityKind,
  EntitySummaries,
  GameModSummary,
  GameOverviewData,
  GameScanWarning,
  GameWarningEditTarget,
  HullReferenceGroup,
  HullReferenceKind,
  HullReferenceOption,
  HullReferencesResult,
  OpenDirectoryKind,
  OpenDirectoryResult,
  InvalidatedEntityRef,
  InvalidatedQueryKind,
  InvalidatedQueryScope,
  InvalidatedResourceScope,
  ProjectInvalidation,
  ProjectManifest,
  ProjectSessionInvalidationResult,
  ProjectSessionId,
  ResourceDataUrlBatchEntry,
  ResourceDataUrlBatchResult,
  ResourceOwnerKind,
  ResourceRef,
  ResourceSource,
  SourceOption,
  SourceOptionGroup,
  TableSummary,
} from '@/shared/types/query.types';
export { RESOURCE_OWNER_KINDS, RESOURCE_SOURCES } from '@/shared/types/query.types';
export type {
  EditableFileData,
  EditorKind,
  EditorResourceKind,
  EditorSpecKind,
  EditorWindowKind,
  WeaponSpecClass,
  ProjectileSpecClass,
} from '@/shared/types/editor.types';
export { EDITOR_KINDS, EDITOR_WINDOW_KINDS } from '@/shared/types/editor.types';
export type {
  ConfigView,
  ModEntry,
  ModOpeningFailure,
  ModOpeningFailureFile,
  ModTableState,
  PersistedMod,
  PersistedWorkspace,
  WorkspaceColumnWidths,
  WorkspaceView,
} from '@/shared/types/workspace.types';
export type { AppFeedback, ChooseOptions, ConfirmOptions } from '@/shared/types/feedback.types';
