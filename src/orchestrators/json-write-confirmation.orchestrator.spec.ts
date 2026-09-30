import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { AppFeedback } from '@/shared/types';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { runConfirmedJsonWrite } from './json-write-confirmation.orchestrator';

const feedback: AppFeedback = {
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  confirmDanger: vi.fn(),
  confirmWarning: vi.fn(),
  choose: vi.fn(async () => 'rewrite'),
};

const rewriteFile = { path: 'M:/mod/demo.ship', reason: '数组元素位置无法对应', sourceFingerprint: 'abc123' };

describe('runConfirmedJsonWrite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    initializeSettingsStore({
      theme: 'light',
      accent: 'blue',
      customAccent: '#2563eb',
      historyLimit: 20,
      editMode: 'smart',
      preserveOriginalJson: true,
      starsectorRoot: null,
      logDirectory: null,
      logLevel: 'info',
    });
  });

  it('confirms a rewrite and retries with the source fingerprint', async () => {
    const write = vi
      .fn()
      .mockRejectedValueOnce({ code: 'json.rewrite_confirmation_required', message: 'confirmation required', files: [rewriteFile] })
      .mockResolvedValueOnce('saved');
    expect(await runConfirmedJsonWrite(feedback, write)).toBe('saved');
    expect(write).toHaveBeenNthCalledWith(1, { preserveOriginalJson: true, confirmedSources: [] });
    expect(write).toHaveBeenNthCalledWith(2, {
      preserveOriginalJson: true,
      confirmedSources: [{ path: rewriteFile.path, sourceFingerprint: rewriteFile.sourceFingerprint }],
    });
    expect(feedback.choose).toHaveBeenCalledTimes(1);
  });

  it('keeps the write uncommitted when confirmation is cancelled', async () => {
    vi.mocked(feedback.choose).mockResolvedValueOnce(null);
    const write = vi
      .fn()
      .mockRejectedValueOnce({ code: 'json.rewrite_confirmation_required', message: 'confirmation required', files: [rewriteFile] });
    expect(await runConfirmedJsonWrite(feedback, write)).toBeNull();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('uses normalizing save without a prompt when the setting is off', async () => {
    useSettingsStore().setPreserveOriginalJson(false);
    const write = vi.fn().mockResolvedValue('saved');
    expect(await runConfirmedJsonWrite(feedback, write)).toBe('saved');
    expect(write).toHaveBeenCalledWith({ preserveOriginalJson: false, confirmedSources: [] });
    expect(feedback.choose).not.toHaveBeenCalled();
  });
});
