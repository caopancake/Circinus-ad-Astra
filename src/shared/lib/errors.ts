import type { ErrorDiagnostic, ErrorLocation, FeedbackNotice, ModOpeningFailure } from '@/shared/types';
import { pathBelongsToRoot } from '@/shared/lib/paths';
import { commandErrorCopy } from '@/shared/lib/error-messages';

export class AppError extends Error {
  readonly action?: string;
  readonly code?: string;
  readonly command?: string;
  readonly location: ErrorLocation | null;
  readonly cause?: unknown;

  constructor(
    message: string,
    options: { action?: string; command?: string; code?: string; location?: ErrorLocation | null; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.action = options.action;
    this.command = options.command;
    this.code = options.code;
    this.location = options.location ?? null;
    this.cause = options.cause;
  }
}

export function withCause(message: string, cause: unknown, action?: string): AppError {
  return new AppError(message, { action, cause });
}

function wireDiagnostic(error: unknown): ErrorDiagnostic | null {
  if (typeof error !== 'object' || error === null) return null;
  const candidate = error as Partial<ErrorDiagnostic>;
  if (typeof candidate.code !== 'string' || typeof candidate.message !== 'string') return null;
  return { code: candidate.code, message: candidate.message, location: candidate.location ?? null };
}

export function errorDiagnosticOf(error: unknown): ErrorDiagnostic {
  if (error instanceof AppError) {
    const source = error.cause === undefined ? null : errorDiagnosticOf(error.cause);
    return {
      code: error.code ?? source?.code ?? 'ui.action_failed',
      message: source?.message ?? error.message,
      location: error.location ?? source?.location ?? null,
    };
  }
  const wire = wireDiagnostic(error);
  if (wire) return wire;
  return {
    code: 'unknown',
    message: error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error',
    location: null,
  };
}

export function commandErrorCode(error: unknown): string | null {
  const code = errorDiagnosticOf(error).code;
  return code === 'unknown' ? null : code;
}

export function errorCodeOf(error: unknown): string {
  return errorDiagnosticOf(error).code;
}

export function errorMessageOf(error: unknown): string {
  return errorDiagnosticOf(error).message;
}

function joinErrorMessages(context: string, source: string): string {
  return !source || context.includes(source) ? context : `${context}：${source}`;
}

export function formatError(error: unknown): string {
  if (error instanceof AppError && error.cause !== undefined) {
    const source = formatError(error.cause);
    return error.command ? source : joinErrorMessages(error.message, source);
  }
  const diagnostic = errorDiagnosticOf(error);
  return commandErrorCopy(diagnostic.code) ?? diagnostic.message;
}

export function errorContextOf(error: unknown): { action?: string; command?: string } {
  if (!(error instanceof AppError)) return {};
  const source = errorContextOf(error.cause);
  return { action: error.action ?? source.action, command: error.command ?? source.command };
}

export function warningNotice(userMessage: string, code: string, message: string): FeedbackNotice {
  return { userMessage, diagnostic: { code, message, location: null } };
}

export interface FileReference {
  path: string;
  line?: number;
  column?: number;
  message: string;
}

export function extractFileReferenceFromError(error: unknown): FileReference | null {
  const diagnostic = errorDiagnosticOf(error);
  const location = diagnostic.location;
  if (!location?.path) return null;
  return {
    path: location.path,
    line: location.line ?? undefined,
    column: location.column ?? undefined,
    message: formatError(error),
  };
}

export function fileReferenceLocationSuffix(line: number, column?: number): string {
  return column ? `第 ${line} 行，第 ${column} 列` : `第 ${line} 行`;
}

export function appendFileReferenceLocation(message: string, reference: FileReference | null): string {
  if (!reference?.line) return message;
  return `${message}（${fileReferenceLocationSuffix(reference.line, reference.column)}）`;
}

export function buildModOpeningFailure(modRoot: string, error: unknown): ModOpeningFailure {
  const diagnostic = errorDiagnosticOf(error);
  const reference = extractFileReferenceFromError(error);
  return {
    modRoot,
    message: formatError(error),
    diagnostic,
    file:
      reference && pathBelongsToRoot(reference.path, modRoot)
        ? { path: reference.path, line: reference.line, column: reference.column }
        : null,
  };
}
