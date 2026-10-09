import type { EditorWindowKind } from '@/shared/types/editor.types';

export type WindowIdentity =
  | { type: 'spec'; sessionId: string; kind: EditorWindowKind; modRoot: string; id: string }
  | { type: 'file'; sessionId: string; modRoot: string; path: string }
  | { type: 'recovery'; modRoot: string | null; path: string };

export interface NativeWindowRequest {
  identity: WindowIdentity;
  title: string;
  url: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export interface ManagedWindowOpened {
  label: string;
  reused: boolean;
}
export interface ManagedWindowStatus {
  dirty: boolean;
  saving: boolean;
}
export interface WindowCloseIntent {
  requestId: number;
  labels: string[];
  onlyIfClean: boolean;
}
