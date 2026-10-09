import { recordLogBestEffort } from '@/services/app-log.service';
import { isEditorWindowKind } from '@/domain/editors/editor-definitions';
import { errorMessageOf } from '@/shared/lib/errors';
import type { RowData } from '@/shared/types';

export function useEditorWindowInput(params: URLSearchParams) {
  const requestedKind = params.get('kind');
  const kind = isEditorWindowKind(requestedKind) ? requestedKind : 'ship';
  const text = params.get('draftSnapshot');
  let draftSnapshot: RowData | null = null;
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) draftSnapshot = parsed as RowData;
    } catch (error) {
      recordLogBestEffort({
        level: 'warning',
        code: 'editor.draft_snapshot_invalid',
        message: errorMessageOf(error),
        path: null,
        line: null,
        fields: null,
      });
    }
  }
  return { kind, draftSnapshot };
}
