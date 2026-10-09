import { pickDirectoryDialog } from '@/shared/runtime/dialog.runtime';
import {
  closeProjectSession,
  detectDirectory,
  invalidateCoreCache,
  invalidateProjectSession,
  openProjectSession,
  scanGameOverview,
  synchronizeCommittedWrite,
} from '@/shared/api/session-api';
import type {
  FileChangeRecord,
  GameOverviewData,
  OpenDirectoryResult,
  ProjectManifest,
  ProjectSessionInvalidationResult,
} from '@/shared/types';
import { recordPerformance } from '@/shared/runtime/performance';

export async function pickDirectory(): Promise<string | null> {
  return pickDirectoryDialog('选择 Starsector 游戏目录或 Mod 目录');
}

export async function openProject(modRoot: string, starsectorRoot: string | null): Promise<ProjectManifest> {
  const fields = { modRoot, hasStarsectorRoot: Boolean(starsectorRoot) };
  const startedAt = performance.now();
  const invokeStartedAt = performance.now();
  const manifest = await openProjectSession(modRoot, starsectorRoot);
  recordPerformance('frontend.openProjectSession.invoke', performance.now() - invokeStartedAt, fields);
  recordPerformance('frontend.openProjectSession', performance.now() - startedAt, fields);
  return manifest;
}

export function scanDirectoryGameOverview(starsectorRoot: string): Promise<GameOverviewData> {
  return scanGameOverview(starsectorRoot);
}

export function detectDirectoryTarget(path: string, knownStarsectorRoot: string | null): Promise<OpenDirectoryResult> {
  return detectDirectory(path, knownStarsectorRoot);
}

export function closeProject(sessionId: string): Promise<void> {
  return closeProjectSession(sessionId);
}

export function requestProjectSessionRefresh(sessionId: string, changes: FileChangeRecord[]): Promise<ProjectSessionInvalidationResult> {
  return invalidateProjectSession(sessionId, changes);
}

export function synchronizeSessionCommit(sessionId: string, modRoot: string, commitId: number) {
  return synchronizeCommittedWrite(sessionId, modRoot, commitId);
}

export function invalidateCoreCacheForRoot(starsectorRoot: string): Promise<void> {
  return invalidateCoreCache(starsectorRoot);
}
