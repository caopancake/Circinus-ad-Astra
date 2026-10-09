import { AppError } from '@/shared/lib/errors';

const pendingSessions = new Map<string, number>();

export function markProjectionPending(sessionId: string, commitId: number) {
  pendingSessions.set(sessionId, Math.max(pendingSessions.get(sessionId) ?? 0, commitId));
}
export function markProjectionReady(sessionId: string, commitId?: number) {
  if (commitId === undefined || commitId >= (pendingSessions.get(sessionId) ?? 0)) pendingSessions.delete(sessionId);
}
export function requireProjectionReady(sessionId: string) {
  if (pendingSessions.has(sessionId)) throw new AppError('项目已写盘，等待会话投影同步', { action: 'session.projection_pending' });
}
