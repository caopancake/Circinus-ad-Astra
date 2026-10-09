import { invokeCommand } from '@/shared/runtime/command.runtime';
import { setPerformanceLogSink } from '@/shared/runtime/performance';
import type { AppLogEntry, AppLogStatus } from '@/shared/types';

export function recordLogBestEffort(entry: AppLogEntry): void {
  void invokeCommand<void>('append_app_log', { payload: { entry } }).catch(ignoreLogFailure);
}

function ignoreLogFailure(): void {
  return;
}

export function startPerformanceLogSink(): () => void {
  return setPerformanceLogSink((entry) => recordLogBestEffort(entry));
}

export function loadLogStatus(): Promise<AppLogStatus> {
  return invokeCommand('get_app_log_status');
}

export function openLogFile(): Promise<void> {
  return invokeCommand('open_app_log_file');
}

export function clearLog(): Promise<AppLogStatus> {
  return invokeCommand('clear_app_log_file');
}
