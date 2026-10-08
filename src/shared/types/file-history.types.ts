export interface FileSaveHistoryEntry {
  id: number;
  timestamp: number;
  paths: string[];
  label: string;
}

export type FileHistoryItem = FileSaveHistoryEntry;

export interface FileHistorySnapshot {
  revision: number;
  undoStack: FileSaveHistoryEntry[];
  redoStack: FileSaveHistoryEntry[];
}
