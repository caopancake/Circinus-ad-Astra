import { openManagedWindow } from '@/windows/managed.window';
import type { AppSettings, EditorWindowKind, ProjectSessionId, RowData } from '@/shared/types';
import { editorWindowDefinition, editorWindowTitle } from '@/domain/editors/editor-definitions';
import { WINDOW_EVENTS } from '@/windows/window.events';

// Independent cap for draftSnapshot passed through the URL query: drop the param above
// the limit so the preview window degrades to the saved bundle instead of failing to open.
const DRAFT_SNAPSHOT_QUERY_LIMIT = 8000;

export interface EditorWindowRequest {
  kind: EditorWindowKind;
  sessionId: ProjectSessionId;
  modRoot: string;
  id: string;
  settings: AppSettings;
  starsectorRoot?: string | null;
  title?: string;
  draftSnapshot?: RowData;
}

export async function openEditorWindow(request: EditorWindowRequest): Promise<void> {
  const definition = editorWindowDefinition(request.kind);
  const serializedDraft = draftSnapshotParam(request.draftSnapshot);
  await openManagedWindow({
    identity: { type: 'spec', sessionId: request.sessionId, kind: request.kind, modRoot: request.modRoot, id: request.id },
    title: request.title ?? editorWindowTitle(request.kind, request.id),
    urlParams: {
      window: 'editor',
      kind: request.kind,
      sessionId: request.sessionId,
      modRoot: request.modRoot,
      id: request.id,
      settings: JSON.stringify(request.settings),
      starsectorRoot: request.starsectorRoot,
      draftSnapshot: serializedDraft,
    },
    size: definition.size,
    focusEvent:
      request.kind === 'weapon-preview' && serializedDraft
        ? {
            name: WINDOW_EVENTS.editorPreviewDraftUpdated,
            data: { sessionId: request.sessionId, modRoot: request.modRoot, id: request.id, draft: request.draftSnapshot },
          }
        : undefined,
  });
}

function draftSnapshotParam(draftSnapshot: RowData | undefined): string | undefined {
  if (!draftSnapshot) return undefined;
  const serialized = JSON.stringify(draftSnapshot);
  return serialized.length <= DRAFT_SNAPSHOT_QUERY_LIMIT ? serialized : undefined;
}

export function openProjectileEditorWindow(request: Omit<EditorWindowRequest, 'kind'>): Promise<void> {
  return openEditorWindow({ ...request, kind: 'projectile' });
}

export function openWeaponPreviewWindow(request: Omit<EditorWindowRequest, 'kind'>): Promise<void> {
  return openEditorWindow({ ...request, kind: 'weapon-preview' });
}
