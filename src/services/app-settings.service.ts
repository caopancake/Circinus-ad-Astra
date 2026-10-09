import { invokeCommand } from '@/shared/runtime/command.runtime';
import type { AppSettings } from '@/shared/types';

export function loadSettings(): Promise<AppSettings> {
  return invokeCommand('load_app_settings');
}

export function saveSettings(settings: AppSettings): Promise<AppSettings> {
  return invokeCommand('save_app_settings', { payload: { settings } });
}
