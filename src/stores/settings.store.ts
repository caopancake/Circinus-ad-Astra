import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { darkTheme, lightTheme } from 'naive-ui/es/themes';
import type { AccentPreset, AppSettings, AppTheme, EditMode, LogLevel } from '@/shared/types';
import { ACCENT_PRESETS, createThemeColors } from '@/domain/settings/theme';
import {
  assertValidSettings,
  readAccent,
  readCustomAccent,
  readEditMode,
  readHistoryLimit,
  readLogLevel,
  readOptionalLogDirectory,
  readPreserveOriginalJson,
  readTheme,
  normalizeHex,
  MAX_HISTORY_LIMIT,
} from '@/domain/settings/rules';

let initialSettings: AppSettings | null = null;

export function initializeSettingsStore(settings: AppSettings): void {
  assertValidSettings(settings);
  initialSettings = settings;
}

export const useSettingsStore = defineStore('settings', () => {
  if (!initialSettings) throw new Error('Settings store used before initialization');
  const theme = ref<AppTheme>(readTheme(initialSettings.theme));
  const accent = ref<AccentPreset>(readAccent(initialSettings.accent));
  const customAccent = ref(readCustomAccent(initialSettings.customAccent));
  const historyLimit = ref(readHistoryLimit(initialSettings.historyLimit));
  const editMode = ref<EditMode>(readEditMode(initialSettings.editMode));
  const preserveOriginalJson = ref(readPreserveOriginalJson(initialSettings.preserveOriginalJson));
  const starsectorRoot = ref(initialSettings.starsectorRoot);
  const logDirectory = ref(readOptionalLogDirectory(initialSettings.logDirectory));
  const logLevel = ref<LogLevel>(readLogLevel(initialSettings.logLevel));
  const naiveTheme = computed(() => (theme.value === 'dark' ? darkTheme : lightTheme));
  const isDark = computed(() => theme.value === 'dark');
  const isPlainEditMode = computed(() => editMode.value === 'plain');
  const activeAccentHex = computed(() => {
    if (accent.value === 'custom') return customAccent.value;
    const preset = ACCENT_PRESETS.find((item) => item.value === accent.value);
    if (!preset) throw new Error(`Invalid app accent: ${accent.value}`);
    return preset.hex;
  });
  const themeColors = computed(() => createThemeColors(activeAccentHex.value, theme.value));

  function setTheme(nextTheme: AppTheme) {
    theme.value = nextTheme;
  }

  function toggleTheme() {
    setTheme(theme.value === 'dark' ? 'light' : 'dark');
  }

  function setAccent(nextAccent: AccentPreset) {
    accent.value = nextAccent;
  }

  function setCustomAccent(value: string): boolean {
    const normalized = normalizeHex(value);
    if (!normalized) return false;
    customAccent.value = normalized;
    accent.value = 'custom';
    return true;
  }

  function setHistoryLimit(limit: number) {
    historyLimit.value = Math.max(1, Math.min(MAX_HISTORY_LIMIT, Math.round(limit)));
  }

  function setEditMode(mode: EditMode) {
    editMode.value = mode;
  }

  function setPreserveOriginalJson(enabled: boolean) {
    preserveOriginalJson.value = readPreserveOriginalJson(enabled);
  }

  function setStarsectorRoot(path: string | null) {
    starsectorRoot.value = path;
  }

  function setLogDirectory(path: string | null) {
    logDirectory.value = readOptionalLogDirectory(path);
  }

  function setLogLevel(level: LogLevel) {
    logLevel.value = level;
  }

  function settingsSnapshot() {
    return {
      theme: theme.value,
      accent: accent.value,
      customAccent: customAccent.value,
      historyLimit: historyLimit.value,
      editMode: editMode.value,
      preserveOriginalJson: preserveOriginalJson.value,
      starsectorRoot: starsectorRoot.value,
      logDirectory: logDirectory.value,
      logLevel: logLevel.value,
    };
  }

  function replaceSettings(settings: AppSettings) {
    theme.value = readTheme(settings.theme);
    accent.value = readAccent(settings.accent);
    customAccent.value = readCustomAccent(settings.customAccent);
    historyLimit.value = readHistoryLimit(settings.historyLimit);
    editMode.value = readEditMode(settings.editMode);
    preserveOriginalJson.value = readPreserveOriginalJson(settings.preserveOriginalJson);
    starsectorRoot.value = settings.starsectorRoot;
    logDirectory.value = readOptionalLogDirectory(settings.logDirectory);
    logLevel.value = readLogLevel(settings.logLevel);
  }

  return {
    accent,
    activeAccentHex,
    customAccent,
    editMode,
    preserveOriginalJson,
    historyLimit,
    logDirectory,
    logLevel,
    isDark,
    isPlainEditMode,
    naiveTheme,
    starsectorRoot,
    theme,
    themeColors,
    setAccent,
    setCustomAccent,
    setEditMode,
    setPreserveOriginalJson,
    setHistoryLimit,
    setLogDirectory,
    setLogLevel,
    setStarsectorRoot,
    setTheme,
    toggleTheme,
    replaceSettings,
    settingsSnapshot,
  };
});
