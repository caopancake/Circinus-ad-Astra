import { entityTargetFixture } from '@/test/entity-target';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope, nextTick, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfigFamilyEditorViewModel } from './use-config-family-editor-view-model';
import { useConfigFactionEditorViewModel } from './use-config-faction-editor-view-model';
import { useConfigMissionEditorViewModel } from './use-config-mission-editor-view-model';
import { variantFamily, skinFamily, type ConfigFamilyFile } from '@/domain/config/config-entity-families';
import type { FileSchema } from '@/domain/schema/schema.types';
import type { RowData } from '@/shared/types';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { savedWriteFixture } from '@/test/write-result';

vi.mock('@/orchestrators/config-save.orchestrator', () => ({ completeConfigSave: vi.fn(async () => {}) }));

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn(), warning: vi.fn(), success: vi.fn() }) }));
vi.mock('@/app/composables/use-schema-runtime-context', () => ({ createSchemaRuntimeContext: () => ({}) }));
vi.mock('@/services/hull-reference.service', () => ({ queryBuiltInWeaponSlotOptions: vi.fn(async () => []) }));

const missionSchema: FileSchema = {
  id: 'mission',
  sources: [
    { id: 'list', type: 'csv-row', path: 'list.csv' },
    { id: 'descriptor', type: 'json-file', path: 'descriptor.json' },
    { id: 'text', type: 'text-file', path: 'text.txt' },
  ],
};

describe('configuration target boundaries', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it.each(['variant', 'skin', 'faction', 'mission'] as const)('loads the new Mod baseline for a reused %s id', async (kind) => {
    const scope = effectScope();
    const modRoot = ref('M:/A'),
      sessionId = ref('sA'),
      revision = ref(0),
      selected = ref('same');
    const capture = vi.fn(async (session: string, root: string, target: unknown, draft: RowData) => {
      void [session, root, target, draft];
      return null;
    });
    let replace = () => {};
    const vm = scope.run(() => {
      if (kind === 'variant' || kind === 'skin') {
        const family = kind === 'variant' ? variantFamily : skinFamily;
        const file = (name: string): ConfigFamilyFile => ({
          target: entityTargetFixture(kind, 'same'),
          id: 'same',
          path: `M:/mod/data/${kind}/same`,
          baseVersions: [],
          relPath: `data/${kind}/same`,
          data: { [family.idField]: 'same', [family.companionField]: 'hull', displayName: name },
        });
        const files = ref([file('A')]);
        replace = () => {
          files.value = [file('B')];
        };
        return useConfigFamilyEditorViewModel({
          family,
          files,
          modRoot,
          sessionId,
          selectedId: selected,
          dataRevision: revision,
          onSaved: () => {},
          saveFile: capture,
        });
      }
      if (kind === 'faction') {
        const factions = ref<Record<string, RowData>>({ same: { id: 'same', displayName: 'A' } });
        replace = () => {
          factions.value = { same: { id: 'same', displayName: 'B' } };
        };
        return useConfigFactionEditorViewModel({
          factions,
          factionVersions: ref({}),
          factionId: selected,
          modRoot,
          sessionId,
          dataRevision: revision,
          previewRevision: ref(0),
          schema: ref({ id: 'faction' }),
          onSaved: () => {},
          queryPreviewImages: async () => ({ logoSrc: '', crestSrc: '' }),
          saveFaction: capture,
        });
      }
      return useConfigMissionEditorViewModel({
        modRoot,
        sessionId,
        missionId: selected,
        editorReloadToken: revision,
        iconRefreshToken: ref(0),
        schema: ref(missionSchema),
        onSaved: () => {},
        saveMission: capture,
        queryMissionIcon: async () => '',
        queryMissionEditorData: async () => ({
          baseVersions: [],
          list: { mission: 'same' },
          descriptor: { title: sessionId.value === 'sA' ? 'A' : 'B' },
          text: '',
          iconSrc: '',
        }),
      });
    })!;
    await nextTick();
    await nextTick();
    if (kind === 'faction') vm.draftData.value = { file: { id: 'same', displayName: 'A dirty' } };
    else if (kind === 'mission')
      vm.draftData.value = { list: { mission: 'same' }, descriptor: { title: 'A dirty' }, text: { content: '' } };
    else vm.draftData.value = { ...vm.draftData.value, displayName: 'A dirty' };
    expect(useDraftSessionsStore().hasUnsavedWorkForMod('M:/A')).toBe(true);
    modRoot.value = 'M:/B';
    sessionId.value = 'sB';
    replace();
    revision.value++;
    await nextTick();
    await nextTick();
    await vm.save();
    expect(capture.mock.calls[0]?.slice(0, 2)).toEqual(['sB', 'M:/B']);
    const submitted = capture.mock.calls[0]![3];
    expect(
      kind === 'faction'
        ? (submitted.file as RowData).displayName
        : kind === 'mission'
          ? (submitted.descriptor as RowData).title
          : submitted.displayName,
    ).toBe('B');
    scope.stop();
  });

  it.each([variantFamily, skinFamily])('hands off a renamed $id while preserving later typing', async (family) => {
    const scope = effectScope();
    const selectedId = ref('old');
    const files = ref<ConfigFamilyFile[]>([
      {
        target: entityTargetFixture(family.id, 'old'),
        id: 'old',
        path: 'M:/mod/old.path',
        baseVersions: [],
        relPath: 'old.path',
        data: { [family.idField]: 'old', [family.companionField]: 'hull', displayName: 'initial' },
      },
    ]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const vm = scope.run(() =>
      useConfigFamilyEditorViewModel({
        family,
        files,
        selectedId,
        modRoot: ref('M:/mod'),
        sessionId: ref('s1'),
        dataRevision: ref(0),
        onSaved: (id) => {
          selectedId.value = id!;
        },
        saveFile: async (_session, _root, _file, draft) => {
          await gate;
          const saved = {
            target: entityTargetFixture(family.id, 'new'),
            id: 'new',
            path: 'M:/mod/new.path',
            baseVersions: [],
            relPath: 'new.path',
            data: draft,
          };
          files.value = [saved];
          return { entity: saved, receipt: savedWriteFixture() };
        },
      }),
    )!;
    await nextTick();
    vm.draftData.value = { ...vm.draftData.value, [family.idField]: 'new', displayName: 'submitted' };
    const saving = vm.save();
    vm.draftData.value = { ...vm.draftData.value, displayName: 'later' };
    release();
    await saving;
    await nextTick();
    expect(selectedId.value).toBe('new');
    expect(vm.draftData.value.displayName).toBe('later');
    expect(vm.saving.value).toBe(false);
    expect(useDraftSessionsStore().hasUnsavedWorkForMod('M:/mod')).toBe(true);
    scope.stop();
  });
});
