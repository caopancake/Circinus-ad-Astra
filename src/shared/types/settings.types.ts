export const APP_THEMES = ['light', 'dark'] as const;
export type AppTheme = (typeof APP_THEMES)[number];

export const ACCENT_PRESET_VALUES = ['blue', 'orange', 'green', 'cyan', 'pink', 'purple', 'gray', 'custom'] as const;
export type AccentPreset = (typeof ACCENT_PRESET_VALUES)[number];

export const EDIT_MODES = ['plain', 'smart'] as const;
export type EditMode = (typeof EDIT_MODES)[number];

export const LOG_LEVELS = ['info', 'debug'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface AppSettings {
  theme: AppTheme;
  accent: AccentPreset;
  customAccent: string;
  historyLimit: number;
  editMode: EditMode;
  preserveOriginalJson?: boolean;
  allowCoreEditing?: boolean;
  starsectorRoot: string | null;
  logDirectory: string | null;
  logLevel: LogLevel;
}
