import type { FeedbackFileSession } from '@/shared/lib/feedback-session';
import type { WindowIdentity } from '@/shared/types';

export function publishCurrentWindowIdentity(identity: WindowIdentity): void {
  const url = new URL(window.location.href);
  if (identity.type === 'spec') {
    url.searchParams.set('sessionId', identity.sessionId);
    url.searchParams.set('modRoot', identity.modRoot);
    url.searchParams.set('kind', identity.kind);
    url.searchParams.set('id', identity.id);
  } else {
    url.searchParams.set('file', identity.path);
    if (identity.modRoot !== null) url.searchParams.set('modRoot', identity.modRoot);
    if (identity.type === 'file') url.searchParams.set('sessionId', identity.sessionId);
  }
  window.history.replaceState(null, '', url);
}

/// Session identity carried by child-window URLs (editor and file-editor
/// windows). The main window URL carries no session identity, so this returns
/// null there and the manifest lookup stays the only authorization source.
export function currentWindowSessionIdentity(): FeedbackFileSession | null {
  const params = new URLSearchParams(window.location.search);
  const modRoot = params.get('modRoot');
  const sessionId = params.get('sessionId');
  if (!modRoot || !sessionId) return null;
  return { modRoot, sessionId };
}
