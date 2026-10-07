import {
  ACCENT_PRESET_VALUES,
  APP_THEMES,
  EDIT_MODES,
  LOG_LEVELS,
  type AccentPreset,
  type AppSettings,
  type AppTheme,
  type EditMode,
  type LogLevel,
} from '@/shared/types';

export const MAX_HISTORY_LIMIT = 100;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isAccentPreset(value: string | null): value is AccentPreset {
  return isSharedSettingValue(ACCENT_PRESET_VALUES, value);
}

function isSharedSettingValue<T extends readonly string[]>(values: T, value: string | null): value is T[number] {
  return Boolean(value && values.includes(value));
}

export function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function assertValidSettings(settings: AppSettings): void {
  readTheme(settings.theme);
  readAccent(settings.accent);
  readCustomAccent(settings.customAccent);
  readHistoryLimit(settings.historyLimit);
  readEditMode(settings.editMode);
  readPreserveOriginalJson(settings.preserveOriginalJson);
  readAllowCoreEditing(settings.allowCoreEditing);
  readLogLevel(settings.logLevel);
  readOptionalLogDirectory(settings.logDirectory);
}

export function readAllowCoreEditing(value: boolean | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new Error(`Invalid allow core editing setting: ${value}`);
  return value;
}

export function readTheme(value: AppTheme): AppTheme {
  if (!isSharedSettingValue(APP_THEMES, value)) throw new Error(`Invalid app theme: ${value}`);
  return value;
}

export function readAccent(value: AccentPreset): AccentPreset {
  if (!isAccentPreset(value)) throw new Error(`Invalid app accent: ${value}`);
  return value;
}

export function readCustomAccent(value: string): string {
  const customAccent = normalizeHex(value);
  if (!customAccent) throw new Error(`Invalid custom accent: ${value}`);
  return customAccent;
}

export function readHistoryLimit(value: number): number {
  if (!Number.isFinite(value) || value < 1 || value > MAX_HISTORY_LIMIT) throw new Error(`Invalid history limit: ${value}`);
  return Math.round(value);
}

export function readEditMode(value: EditMode): EditMode {
  if (!isSharedSettingValue(EDIT_MODES, value)) throw new Error(`Invalid edit mode: ${value}`);
  return value;
}

export function readPreserveOriginalJson(value: boolean | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'boolean') throw new Error(`Invalid preserve original JSON setting: ${value}`);
  return value;
}

export function readLogLevel(value: LogLevel): LogLevel {
  if (!isSharedSettingValue(LOG_LEVELS, value)) throw new Error(`Invalid log level: ${value}`);
  return value;
}

export function readOptionalLogDirectory(value: string | null): string | null {
  if (value === null) return null;
  if (!value.trim()) throw new Error('Invalid log directory: blank');
  return value;
}
