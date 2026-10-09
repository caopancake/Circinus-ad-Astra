import { recordLogBestEffort } from '@/services/app-feedback-log.service';
import { errorDiagnosticOf } from '@/shared/lib/errors';
import { logFields } from '@/shared/lib/log-fields';

export function recordWindowEventHandlerError(error: unknown, event: string): void {
  const diagnostic = errorDiagnosticOf(error);
  recordLogBestEffort({
    level: 'error',
    code: diagnostic.code,
    message: diagnostic.message,
    path: diagnostic.location?.path ?? null,
    line: diagnostic.location?.line ?? null,
    fields: logFields({ event, column: diagnostic.location?.column }),
  });
}
