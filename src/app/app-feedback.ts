import { h, type CSSProperties, type VNode } from 'vue';
import { NButton } from 'naive-ui/es/button';
import type { DialogApiInjection } from 'naive-ui/es/dialog/src/DialogProvider';
import type { MessageApiInjection } from 'naive-ui/es/message/src/MessageProvider';
import { NSpace } from 'naive-ui/es/space';
import { NText } from 'naive-ui/es/typography';
import {
  commandErrorCode,
  extractFileReferenceFromError,
  fileReferenceLocationSuffix,
  formatError,
  errorDiagnosticOf,
  AppError,
  type FileReference,
} from '@/shared/lib/errors';
import { resolveFeedbackFileSession, type FeedbackFileSession } from '@/shared/lib/feedback-session';
import type { AppFeedback, ChooseOptions, ConfirmOptions } from '@/shared/types';
import { emitFileEditorSaved } from '@/orchestrators/file-editor-window.orchestrator';
import { openFileEditorWindow } from '@/windows/file-editor.window';
import type { FileEditorContextSeverity } from '@/windows/window.events';
import { currentWindowSessionIdentity } from '@/windows/window-identity.window';
import { transcodeFileToUtf8 } from '@/services/files.service';
import { recordLogBestEffort } from '@/services/app-feedback-log.service';
import { errorMessageOf } from '@/shared/lib/errors';
import { useSettingsStore } from '@/stores/settings.store';
import { useProjectStore } from '@/stores/project.store';
import { closestRootForPath } from '@/shared/lib/paths';
import { logFields } from '@/shared/lib/log-fields';

type ToastLevel = 'success' | 'info' | 'warning' | 'error';

interface ToastContext {
  contextLabel: string;
  contextSeverity: FileEditorContextSeverity;
  buttonType: 'default' | 'success' | 'warning' | 'error';
}

const TOAST_CONTEXT: Record<ToastLevel, ToastContext> = {
  success: { contextLabel: '信息', contextSeverity: 'info', buttonType: 'success' },
  info: { contextLabel: '信息', contextSeverity: 'info', buttonType: 'default' },
  warning: { contextLabel: '警告', contextSeverity: 'warning', buttonType: 'warning' },
  error: { contextLabel: '错误', contextSeverity: 'error', buttonType: 'error' },
};

const TOAST_TEXT_STYLE: CSSProperties = { maxWidth: '680px', overflowWrap: 'anywhere' };

// Only this error declares a file whose bytes the reader refused outright; it
// is the one case where transcoding with a user-chosen source encoding applies.
const TRANSCODABLE_ERROR_CODE = 'text.invalid_utf8';

interface ToastOptions {
  transcodable?: boolean;
  reference?: FileReference | null;
}

export function createAppFeedback(message: MessageApiInjection, dialog: DialogApiInjection): AppFeedback {
  return {
    success: (text) => {
      showToast(message, dialog, 'success', text);
    },
    info: (text) => {
      showToast(message, dialog, 'info', text);
    },
    warning: (notice) => {
      const reference = extractFileReferenceFromError(notice.diagnostic);
      showToast(message, dialog, 'warning', notice.userMessage, { reference });
      recordLogBestEffort({
        level: 'warning',
        code: notice.diagnostic.code,
        message: notice.diagnostic.message,
        path: reference?.path ?? null,
        line: reference?.line ?? null,
        fields: logFields({ column: notice.diagnostic.location?.column }),
      });
    },
    error: (error, contextMessage) => showErrorToast(message, dialog, error, contextMessage),
    confirmDanger: (options) => showConfirm(dialog, 'error', options),
    confirmWarning: (options) => showConfirm(dialog, 'warning', options),
    choose: (options) => showChoose(dialog, options),
  };
}

function showErrorToast(message: MessageApiInjection, dialog: DialogApiInjection, error: unknown, contextMessage?: string): void {
  const text = contextMessage ? `${contextMessage}：${formatError(error)}` : formatError(error);
  const diagnostic = errorDiagnosticOf(error);
  const reference = showToast(message, dialog, 'error', text, {
    reference: extractFileReferenceFromError(error),
    transcodable: diagnostic.code === TRANSCODABLE_ERROR_CODE,
  });
  recordLogBestEffort({
    level: 'error',
    code: diagnostic.code,
    message: diagnostic.message,
    path: reference?.path ?? null,
    line: reference?.line ?? null,
    fields: logFields({ action: error instanceof AppError ? error.action : contextMessage, column: diagnostic.location?.column }),
  });
}

function showConfirm(dialog: DialogApiInjection, type: 'error' | 'warning', options: ConfirmOptions) {
  dialog[type]({
    title: options.title,
    content: options.content,
    positiveText: options.actionText,
    negativeText: '取消',
    onPositiveClick: () => options.onConfirm(),
    onNegativeClick: options.onCancel,
    onClose: options.onCancel,
    onMaskClick: options.onCancel,
  });
}

function showToast(
  message: MessageApiInjection,
  dialog: DialogApiInjection,
  level: ToastLevel,
  text: string,
  options?: ToastOptions,
): FileReference | null {
  const reference = options?.reference ?? null;
  const session = reference === null ? null : resolveSessionForPath(reference.path);
  const content = () => renderToastContent(message, dialog, level, text, reference, session, options);
  // Error toasts stay open until closed manually: naive-ui skips the
  // auto-close timer entirely when duration is 0. Other levels inherit the
  // provider baseline (10s, closable, keep-alive-on-hover).
  if (level === 'error') message.error(content, { duration: 0 });
  else if (level === 'warning') message.warning(content);
  else if (level === 'info') message.info(content);
  else message.success(content);
  return reference;
}

function resolveSessionForPath(path: string): FeedbackFileSession | null {
  const project = useProjectStore();
  const modRoot = closestRootForPath(project.manifests.keys(), path);
  const sessionId = modRoot === null ? null : project.getSessionId(modRoot);
  return resolveFeedbackFileSession(modRoot, sessionId, currentWindowSessionIdentity(), path);
}

function renderToastContent(
  message: MessageApiInjection,
  dialog: DialogApiInjection,
  level: ToastLevel,
  text: string,
  reference: FileReference | null,
  session: FeedbackFileSession | null,
  options: ToastOptions | undefined,
): VNode {
  const rows: VNode[] = [h('span', { style: TOAST_TEXT_STYLE }, text)];
  if (reference !== null) {
    const locationText = fileReferenceText(reference);
    rows.push(h(NText, { depth: 3, style: TOAST_TEXT_STYLE }, { default: () => locationText }));
  }
  if (reference !== null && session !== null) {
    const actionRequest = { message, dialog, reference, session, level };
    const actions: VNode[] = [
      toastAction('打开文件', TOAST_CONTEXT[level].buttonType, () =>
        openReferenceInEditor(actionRequest.reference, actionRequest.session, actionRequest.level),
      ),
    ];
    if (options?.transcodable === true) {
      actions.push(
        toastAction('转码为 UTF-8', 'warning', () =>
          transcodeReferenceToUtf8(actionRequest.message, actionRequest.dialog, actionRequest.reference, actionRequest.session),
        ),
      );
    }
    rows.push(h(NSpace, { size: 'small', wrap: false, align: 'center' }, { default: () => actions }));
  }
  return h(NSpace, { vertical: true, size: 'small', wrap: false, align: 'start' }, { default: () => rows });
}

function toastAction(label: string, type: ToastContext['buttonType'], onClick: () => void): VNode {
  return h(NButton, { size: 'tiny', type, secondary: true, onClick }, { default: () => label });
}

async function transcodeReferenceToUtf8(
  message: MessageApiInjection,
  dialog: DialogApiInjection,
  reference: FileReference,
  session: FeedbackFileSession,
): Promise<void> {
  const encoding = await showChoose(dialog, {
    title: '转码为 UTF-8',
    content: '该文件不是有效的 UTF-8。选择其当前编码，解码结果将以 UTF-8 写回且不可逆。',
    choices: [
      { label: 'GBK / GB18030（简体中文）', value: 'gb18030', type: 'primary' },
      { label: 'Windows-1252（西文）', value: 'windows-1252' },
    ],
  });
  if (encoding === null) return;
  try {
    const result = await transcodeFileToUtf8(session.sessionId, session.modRoot, reference.path, encoding);
    await emitFileEditorSaved({
      modRoot: session.modRoot,
      path: reference.path,
      sessionId: session.sessionId,
      writeResult: result,
    });
    showToast(message, dialog, 'success', `已转码为 UTF-8：${reference.path}`);
  } catch (error) {
    showErrorToast(message, dialog, error, '转码为 UTF-8 失败');
  }
}

function fileReferenceText(reference: FileReference): string {
  return reference.line ? `${reference.path}（${fileReferenceLocationSuffix(reference.line, reference.column)}）` : reference.path;
}

function openReferenceInEditor(reference: FileReference, session: FeedbackFileSession, level: ToastLevel): Promise<void> {
  const context = TOAST_CONTEXT[level];
  return openFileEditorWindow({
    modRoot: session.modRoot,
    path: reference.path,
    sessionId: session.sessionId,
    line: reference.line,
    column: reference.column,
    settings: useSettingsStore().settingsSnapshot(),
    title: '文件编辑器',
    contextLabel: context.contextLabel,
    contextSeverity: context.contextSeverity,
    message: reference.message,
  }).catch((error) => {
    recordLogBestEffort({
      level: 'error',
      code: commandErrorCode(error) ?? 'unknown',
      message: errorMessageOf(error) ?? 'error file open failed',
      path: reference.path,
      line: reference.line ?? null,
      fields: null,
    });
  });
}

function showChoose(dialog: DialogApiInjection, options: ChooseOptions): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const instance = dialog.create({
      type: 'info',
      title: options.title,
      content: options.content,
      closable: true,
      showIcon: false,
      action: () =>
        h(
          NSpace,
          { justify: 'end', size: 'small' },
          {
            default: () => [
              ...options.choices.map((choice) =>
                h(
                  NButton,
                  {
                    type: choice.type ?? 'default',
                    size: 'small',
                    onClick: () => {
                      resolved = true;
                      instance.destroy();
                      resolve(choice.value);
                    },
                  },
                  { default: () => choice.label },
                ),
              ),
              h(
                NButton,
                {
                  size: 'small',
                  onClick: () => {
                    resolved = true;
                    instance.destroy();
                    resolve(null);
                  },
                },
                { default: () => '取消' },
              ),
            ],
          },
        ),
      onClose: () => {
        if (!resolved) resolve(null);
      },
      onMaskClick: () => {
        if (!resolved) {
          resolved = true;
          instance.destroy();
          resolve(null);
        }
      },
    });
  });
}
