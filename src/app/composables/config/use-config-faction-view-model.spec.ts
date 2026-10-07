import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileSchema } from '@/domain/schema/schema.types';
import type { AppFeedback } from '@/shared/types';
import { useConfigFactionViewModel } from './use-config-faction-view-model';

const mocks = vi.hoisted(() => ({
  saveIndexedEntityAction: vi.fn(() => Promise.resolve({ changes: [], refreshed: {} })),
  createIndexedEntityAction: vi.fn(() => Promise.resolve({ changes: [], refreshed: {} })),
  deleteIndexedEntityAction: vi.fn(() => Promise.resolve({ changes: [], refreshed: {} })),
  listConfigFactionRecords: vi.fn(() => Promise.resolve([])),
  queryFactionPreviewImages: vi.fn(() => Promise.resolve([])),
  subscribeQueryInvalidations: vi.fn(() => () => {}),
  subscribeResourceInvalidations: vi.fn(() => () => {}),
  hasEntityInvalidation: vi.fn(() => false),
  hasResourceInvalidation: vi.fn(() => false),
}));

vi.mock('@/orchestrators/config-save.orchestrator', () => ({
  saveIndexedEntityAction: mocks.saveIndexedEntityAction,
  createIndexedEntityAction: mocks.createIndexedEntityAction,
  deleteIndexedEntityAction: mocks.deleteIndexedEntityAction,
}));

vi.mock('@/services/config-entity.service', () => ({
  listConfigFactionRecords: mocks.listConfigFactionRecords,
  queryFactionPreviewImages: mocks.queryFactionPreviewImages,
}));

vi.mock('@/services/query-cache.service', () => ({
  subscribeQueryInvalidations: mocks.subscribeQueryInvalidations,
  hasEntityInvalidation: mocks.hasEntityInvalidation,
}));

vi.mock('@/services/resource-cache.service', () => ({
  subscribeResourceInvalidations: mocks.subscribeResourceInvalidations,
  hasResourceInvalidation: mocks.hasResourceInvalidation,
}));

const feedbackStub: AppFeedback = {
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  confirmDanger: vi.fn(),
  confirmWarning: vi.fn(),
  choose: vi.fn(() => Promise.resolve(null)),
};

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => feedbackStub,
}));

vi.mock('@/app/composables/use-schema-runtime-context', () => ({
  useSchemaRuntimeContext: () => null,
}));

const schema = {
  sources: [{ id: 'file', type: 'json-file', path: 'data/world/factions/existing.faction' }],
} as unknown as FileSchema;

function mountViewModel(): ReturnType<typeof useConfigFactionViewModel> {
  let vm!: ReturnType<typeof useConfigFactionViewModel>;
  mount(
    {
      setup() {
        vm = useConfigFactionViewModel();
        return () => null;
      },
    },
    { global: { plugins: [createPinia()] } },
  );
  return vm;
}

describe('useConfigFactionViewModel saveFaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps previousId on same-id saves so the backend treats them as updates', async () => {
    const vm = mountViewModel();
    const local = { file: { id: 'existing', displayName: 'Existing' } };

    await vm.saveFaction('sess-1', 'M:/mod', 'existing', local, schema);

    expect(mocks.saveIndexedEntityAction).toHaveBeenCalledWith(
      expect.objectContaining({ previousId: 'existing', nextId: 'existing', deletePreviousTarget: false }),
      feedbackStub,
    );
  });

  it('passes the old id on renames and keeps the delete-previous flag', async () => {
    const vm = mountViewModel();
    const local = { file: { id: 'renamed', displayName: 'Renamed' } };

    await vm.saveFaction('sess-1', 'M:/mod', 'existing', local, schema);

    expect(mocks.saveIndexedEntityAction).toHaveBeenCalledWith(
      expect.objectContaining({ previousId: 'existing', nextId: 'renamed', deletePreviousTarget: true }),
      feedbackStub,
    );
  });

  it('returns no saved id after rejecting an invalid faction id', async () => {
    const vm = mountViewModel();
    expect(await vm.saveFaction('sess-1', 'M:/mod', 'existing', { file: { id: 'bad id' } }, schema)).toBeNull();
    expect(mocks.saveIndexedEntityAction).not.toHaveBeenCalled();
    expect(feedbackStub.warning).toHaveBeenCalledWith(expect.stringContaining('势力 ID'), 'config.id_invalid');
  });
});
