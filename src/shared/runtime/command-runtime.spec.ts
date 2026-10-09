import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invokeCommand } from './command.runtime';
import { AppError, errorContextOf, errorDiagnosticOf, formatError, withCause } from '@/shared/lib/errors';

const mockInvoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: mockInvoke }));
beforeEach(() => vi.clearAllMocks());

describe('command transport', () => {
  it('preserves arguments and the successful result', async () => {
    const result = { target: 'loaded' };
    const args = { payload: { sessionId: null }, title: 'Demo' };
    mockInvoke.mockResolvedValue(result);
    expect(await invokeCommand('read_demo', args)).toBe(result);
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith('read_demo', args);
  });

  it('invokes a command without arguments', async () => {
    mockInvoke.mockResolvedValue(undefined);
    await invokeCommand('release_demo');
    expect(mockInvoke).toHaveBeenCalledExactlyOnceWith('release_demo', undefined);
  });

  it('keeps diagnostics, source payload and separate action context', async () => {
    const cause = {
      code: 'parse.json_syntax',
      message: 'Raw detail',
      location: { path: 'demo.json', line: 3, column: 7 },
      files: ['demo'],
    };
    mockInvoke.mockRejectedValue(cause);
    const error = await invokeCommand('save_demo').catch((error: unknown) => error);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ command: 'save_demo', cause });
    expect(errorDiagnosticOf(error)).toEqual({ code: cause.code, message: cause.message, location: cause.location });
    expect(formatError(error)).toBe('JSON 语法错误');
    const wrapped = withCause('保存失败', error, 'save-demo');
    expect(formatError(wrapped)).toBe('保存失败：JSON 语法错误');
    expect(errorContextOf(wrapped)).toEqual({ action: 'save-demo', command: 'save_demo' });
  });
});
