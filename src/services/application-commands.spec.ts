import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadSettings, saveSettings } from './app-settings.service';
import { clearConfig, openConfigFolder } from './app-config.service';
import { clearLog, loadLogStatus, openLogFile, recordLogBestEffort } from './app-log.service';
import { loadPersistedWorkspace, savePersistedWorkspace } from './workspace-state.service';
import { createNewModProject } from './mod-creation.service';
import { queryCoreFields, queryCoreGraphics, invalidateCoreCacheForRoot } from './core-assets.service';
import { detectDirectoryTarget, scanDirectoryGameOverview } from './directory.service';
import { openProject, closeProject, requestProjectSessionRefresh, synchronizeSessionCommit } from './project-session.service';
import {
  openNativeManagedWindow,
  updateNativeWindowStatus,
  reserveNativeWindowTargets,
  releaseNativeWindowTargets,
  retargetNativeWindow,
  closeNativeSessionWindows,
  cancelNativeWindowClose,
} from './window.service';
import type {
  AppSettings,
  CreateModRequest,
  ManagedWindowStatus,
  NativeWindowRequest,
  PersistedWorkspace,
  WindowIdentity,
} from '@/shared/types';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const settings: AppSettings = {
  theme: 'light',
  accent: 'blue',
  customAccent: '#3388cc',
  historyLimit: 20,
  editMode: 'smart',
  starsectorRoot: null,
  logDirectory: null,
  logLevel: 'info',
};
const state: PersistedWorkspace = { starsectorRoot: null, mods: [], columnWidths: {}, gameMods: [], gameWarnings: [] };
const create: CreateModRequest = {
  destination: { kind: 'directory', parentDirectory: 'M:/' },
  template: { id: 'demo', name: 'Demo', version: '1', gameVersion: '0.98a' },
};
const identity: WindowIdentity = { type: 'file', sessionId: 's1', modRoot: 'M:/mod', path: 'M:/mod/demo.json' };
const request: NativeWindowRequest = { identity, url: 'index.html', title: 'Demo', width: 860, height: 600, minWidth: 500, minHeight: 400 };
const status: ManagedWindowStatus = { dirty: false, saving: false };
const entry = { level: 'warning' as const, code: 'demo', message: 'raw', path: null, line: null, fields: null };
const cases: Array<[string, () => unknown, Record<string, unknown> | undefined]> = [
  ['load_app_settings', loadSettings, undefined],
  ['save_app_settings', () => saveSettings(settings), { payload: { settings } }],
  ['append_app_log', () => recordLogBestEffort(entry), { payload: { entry } }],
  ['get_app_log_status', loadLogStatus, undefined],
  ['open_app_log_file', openLogFile, undefined],
  ['clear_app_log_file', clearLog, undefined],
  ['open_config_dir', openConfigFolder, undefined],
  ['clear_config_files', clearConfig, undefined],
  ['load_workspace', loadPersistedWorkspace, undefined],
  ['save_workspace', () => savePersistedWorkspace(state), { payload: { state } }],
  ['create_mod', () => createNewModProject(create), { payload: create }],
  ['scan_core_fields', () => queryCoreFields('G:/core'), { payload: { starsectorRoot: 'G:/core' } }],
  ['scan_core_graphics', () => queryCoreGraphics('G:/core'), { payload: { starsectorRoot: 'G:/core' } }],
  ['invalidate_core_cache', () => invalidateCoreCacheForRoot('G:/core'), { payload: { starsectorRoot: 'G:/core' } }],
  ['detect_directory', () => detectDirectoryTarget('M:/mod', null), { payload: { path: 'M:/mod', knownStarsectorRoot: null } }],
  ['scan_game_overview', () => scanDirectoryGameOverview('G:/core'), { payload: { starsectorRoot: 'G:/core' } }],
  ['open_project_session', () => openProject('M:/mod', null), { payload: { modRoot: 'M:/mod', starsectorRoot: null } }],
  ['close_project_session', () => closeProject('s1'), { payload: { sessionId: 's1' } }],
  ['invalidate_project_session', () => requestProjectSessionRefresh('s1', []), { payload: { sessionId: 's1', changes: [] } }],
  [
    'synchronize_committed_write',
    () => synchronizeSessionCommit('s1', 'M:/mod', 7),
    { payload: { sessionId: 's1', modRoot: 'M:/mod', commitId: 7 } },
  ],
  ['open_managed_window', () => openNativeManagedWindow(request), { payload: request }],
  ['update_managed_window_status', () => updateNativeWindowStatus(status), { payload: status }],
  ['reserve_window_targets', () => reserveNativeWindowTargets([identity]), { identities: [identity] }],
  ['release_window_targets', releaseNativeWindowTargets, undefined],
  ['retarget_managed_window', () => retargetNativeWindow(identity, 'Demo'), { identity, title: 'Demo' }],
  ['request_session_window_close', () => closeNativeSessionWindows('s1'), { sessionId: 's1' }],
  ['cancel_window_close_request', () => cancelNativeWindowClose(7), { requestId: 7 }],
];
beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue({ ready: true });
});
describe('application capability protocols', () => {
  it.each(cases)('%s maps the formal arguments to Tauri', async (command, action, args) => {
    await action();
    expect(invoke).toHaveBeenCalledExactlyOnceWith(command, args);
  });
});
