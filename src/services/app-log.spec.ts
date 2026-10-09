import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordLogBestEffort, startPerformanceLogSink } from './app-log.service';
import { recordPerformance } from '@/shared/runtime/performance';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue(undefined);
});

describe('application log lifecycle', () => {
  it('registers and releases performance logging explicitly', async () => {
    recordPerformance('before', 1);
    expect(invoke).not.toHaveBeenCalled();
    const stop = startPerformanceLogSink();
    recordPerformance('during', 2);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('append_app_log', {
      payload: {
        entry: {
          level: 'debug',
          code: 'perf',
          message: 'PERF during',
          path: null,
          line: null,
          fields: { ms: '2' },
        },
      },
    });
    stop();
    recordPerformance('after', 3);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('contains a rejected log write at the best-effort owner', async () => {
    invoke.mockRejectedValue({ code: 'io.unexpected', message: 'disk error', location: null });
    expect(() =>
      recordLogBestEffort({ level: 'warning', code: 'demo', message: 'raw', path: null, line: null, fields: null }),
    ).not.toThrow();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('keeps the current registration when an earlier window releases', () => {
    const oldStop = startPerformanceLogSink();
    const currentStop = startPerformanceLogSink();
    oldStop();
    recordPerformance('current', 1);
    expect(invoke).toHaveBeenCalledTimes(1);
    currentStop();
    recordPerformance('released', 1);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
