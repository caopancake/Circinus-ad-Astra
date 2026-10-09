import { invoke } from '@tauri-apps/api/core';
import { AppError, errorMessageOf } from '@/shared/lib/errors';

export async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (cause) {
    throw new AppError(errorMessageOf(cause), { command, cause });
  }
}
