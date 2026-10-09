import type { ProjectManifest, FeedbackNotice, GameScanWarning } from '@/shared/types';
import { formatError } from '@/shared/lib/errors';

export function scanWarningNotice(warning: GameScanWarning): FeedbackNotice {
  return { userMessage: `${formatError(warning)}（${warning.path}）`, diagnostic: warning };
}

export function formatLoadWarnings(loaded: ProjectManifest): FeedbackNotice[] {
  return loaded.warnings.map(scanWarningNotice);
}
