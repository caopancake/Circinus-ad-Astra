import * as filesApi from '@/shared/api/files-api';
import { invokeCommand } from '@/shared/runtime/command.runtime';
import type { AssociatedFileChange, EditableFileData, FileVersion, WriteResult } from '@/shared/types';

export function loadEditableFileData(sessionId: string | null, modRoot: string, path: string): Promise<EditableFileData> {
  return filesApi.loadEditableFile(sessionId, modRoot, path);
}

export function writeEditableFileText(
  sessionId: string | null,
  modRoot: string,
  path: string,
  text: string,
  baseVersions: import('@/shared/types').FileVersion[],
): Promise<WriteResult> {
  return invokeCommand('save_text_file', { payload: { baseVersions, sessionId, modRoot, path, text } });
}

export function transcodeFileToUtf8(
  sessionId: string | null,
  modRoot: string,
  path: string,
  encoding: string,
  baseVersions: FileVersion[] = [],
): Promise<WriteResult> {
  return invokeCommand('transcode_file_to_utf8', { payload: { baseVersions, sessionId, modRoot, path, encoding } });
}

export function saveModFiles(
  sessionId: string,
  modRoot: string,
  files: AssociatedFileChange[],
  baseVersions: FileVersion[] = [],
): Promise<WriteResult> {
  return invokeCommand('save_mod_files', { payload: { baseVersions, sessionId, modRoot, files } });
}

export const queryFileTextIdentityIntent = filesApi.queryTextIdentityIntent;
export const followFileTextIdentity = filesApi.followTextIdentity;
