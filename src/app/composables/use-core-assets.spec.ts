import { createPinia, setActivePinia } from 'pinia';
import { effectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startCoreAssetsLoading, loadCoreFields, loadCoreGraphics } from '@/orchestrators/core-assets.orchestrator';
import { useCoreAssetsStore } from '@/stores/core-assets.store';
import { useCoreGraphics, useCoreSchema } from './use-core-assets';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import type { DiscoveredField } from '@/shared/types';

const mocks = vi.hoisted(() => ({ fields: vi.fn(), graphics: vi.fn(), log: vi.fn() }));
vi.mock('@/services/assets.service', () => ({ queryCoreFields: mocks.fields, queryCoreGraphics: mocks.graphics }));
vi.mock('@/services/app-feedback-log.service', () => ({ recordLogBestEffort: mocks.log }));
const fields: Record<string, DiscoveredField[]> = { faction: [{ key: 'bonus', type: 'string', origin: 'core' }] };
let stop: () => void;
let scope: ReturnType<typeof effectScope>;

beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore({
    theme: 'light',
    accent: 'blue',
    customAccent: '#3388cc',
    historyLimit: 20,
    editMode: 'smart',
    starsectorRoot: 'D:/A',
    logDirectory: null,
    logLevel: 'info',
  });
  vi.clearAllMocks();
  mocks.fields.mockResolvedValue(fields);
  mocks.graphics.mockResolvedValue(['graphics/a.png']);
  scope = effectScope();
  stop = scope.run(startCoreAssetsLoading)!;
});
afterEach(() => {
  stop();
  scope.stop();
});

describe('Core asset ownership and acceptance', () => {
  it('projects loaded fields and graphics through reactive facades', async () => {
    const schema = useCoreSchema();
    const graphics = useCoreGraphics();
    await Promise.all([schema.loadCoreFields(), graphics.loadGraphics()]);
    expect(schema.loaded.value).toBe(true);
    expect(graphics.graphicsPaths.value).toEqual(['graphics/a.png']);
    expect(schema.getMergedSchema('faction')?.sections?.at(-1)?.id).toBe('__core_discovered');
    expect(schema.getMergedSchema('unknown')).toBeNull();
  });

  it('shares the pending promise and waits for its result', async () => {
    let resolve!: (content: typeof fields) => void;
    mocks.fields.mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const first = loadCoreFields();
    const second = loadCoreFields();
    expect(second).toBe(first);
    expect(mocks.fields).toHaveBeenCalledTimes(1);
    resolve(fields);
    await second;
    expect(useCoreAssetsStore().fields.status).toBe('ready');
  });

  it('clears old projections immediately and loads a new root independently', async () => {
    await loadCoreFields();
    let resolve!: (content: typeof fields) => void;
    mocks.fields.mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    useSettingsStore().setStarsectorRoot('D:/B');
    expect(useCoreAssetsStore().fields.content).toEqual({});
    expect(useCoreAssetsStore().fields.status).toBe('loading');
    await loadCoreGraphics();
    expect(useCoreAssetsStore().graphics.status).toBe('ready');
    resolve(fields);
    await loadCoreFields();
  });

  it.each(['resolve', 'reject'] as const)('releases a stale A response on A-B-A: %s', async (completion) => {
    let resolve!: (content: typeof fields) => void;
    let reject!: (error: Error) => void;
    mocks.fields.mockImplementationOnce(
      () =>
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
    );
    const old = loadCoreFields();
    useSettingsStore().setStarsectorRoot('D:/B');
    useSettingsStore().setStarsectorRoot('D:/A');
    await loadCoreFields();
    if (completion === 'resolve') resolve({});
    else reject(new Error('stale'));
    await old;
    expect(useCoreAssetsStore().fields.content).toEqual(fields);
    expect(useCoreAssetsStore().fields.status).toBe('ready');
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it('logs a failure once and retries through the current read entry', async () => {
    mocks.fields.mockRejectedValueOnce({ code: 'parse.json', message: 'raw detail', location: null });
    await Promise.all([loadCoreFields(), loadCoreFields(), loadCoreGraphics()]);
    expect(useCoreAssetsStore().fields.status).toBe('error');
    expect(useCoreAssetsStore().graphics.status).toBe('ready');
    expect(mocks.log).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ code: 'parse.json', message: 'raw detail' }));
    await loadCoreFields();
    expect(useCoreAssetsStore().fields.status).toBe('ready');
  });

  it.each(['clear', 'dispose'] as const)('revokes pending response on %s', async (action) => {
    let resolve!: (content: typeof fields) => void;
    mocks.fields.mockImplementation(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    const pending = loadCoreFields();
    if (action === 'clear') useSettingsStore().setStarsectorRoot(null);
    else stop();
    resolve(fields);
    await pending;
    expect(useCoreAssetsStore().root).toBeNull();
    expect(useCoreAssetsStore().fields).toMatchObject({ content: {}, status: 'idle' });
  });
});
