import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import SchemaFormRenderer from '@/app/components/schema/SchemaFormRenderer.vue';
import { useConfigEditorDraftSession } from '@/app/composables/config/use-config-editor-draft-session';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { initializeSettingsStore } from '@/stores/settings.store';
import { editorUiStubs } from '@/test/ui-stubs';
import type { FileSchema } from '@/domain/schema/schema.types';
import type { RowData } from '@/shared/types';
import { deepClone } from '@/shared/lib/starsector';

vi.mock('@/services/assets.service', () => ({
  queryCoreFields: vi.fn(async () => ({})),
  queryCoreGraphics: vi.fn(async () => []),
}));

vi.mock('@/services/app-feedback-log.service', () => ({ recordLogBestEffort: vi.fn() }));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => ({
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn((options: { onConfirm: () => void }) => options.onConfirm()),
    choose: vi.fn(async () => null),
  }),
}));

const cases: { name: string; key: string; initial: RowData }[] = [
  { name: 'mod-info', key: 'name', initial: { name: 'base' } },
  { name: 'faction', key: 'file.displayName', initial: { file: { displayName: 'base' } } },
  { name: 'mission', key: 'descriptor.title', initial: { descriptor: { title: 'base' } } },
  { name: 'variant', key: 'displayName', initial: { displayName: 'base' } },
  { name: 'skin', key: 'hullName', initial: { hullName: 'base' } },
];

let wrapper: VueWrapper | null = null;

beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore({
    theme: 'light',
    accent: 'blue',
    customAccent: '#3388cc',
    historyLimit: 20,
    editMode: 'smart',
    starsectorRoot: null,
    logDirectory: null,
    logLevel: 'info',
  });
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

async function mountDraftForm(fixture: (typeof cases)[number]) {
  let resolveSave!: (snapshot: { target: string; value: RowData; baseVersions: []; meta: null }) => void;
  const save = vi.fn((...args: [string, RowData]) => {
    void args;
    return new Promise<{ target: string; value: RowData; baseVersions: []; meta: null }>((resolve) => (resolveSave = resolve));
  });
  let session!: ReturnType<typeof useConfigEditorDraftSession<RowData, string>>;
  const schema: FileSchema = {
    $schema: 'circinus-ad-astra/field-schema/v1',
    id: fixture.name,
    sections: [{ id: 'main', label: 'Fields', fields: [{ key: fixture.key, type: 'string', label: 'Name' }] }],
  };
  wrapper = mount(
    {
      components: { SchemaFormRenderer },
      setup() {
        session = useConfigEditorDraftSession<RowData, string>({
          emptyValue: {},
          modRoot: ref('M:/mod'),
          targetKey: (id) => id,
          load: () => ({ target: 'target', value: deepClone(fixture.initial), baseVersions: [], meta: null }),
          save,
        });
        return { draftData: session.draftValue, schema };
      },
      template: '<SchemaFormRenderer :schema="schema" v-model="draftData" />',
    },
    { global: { stubs: editorUiStubs } },
  );
  await session.loadTarget('target');
  return {
    session,
    save,
    resolveSave: (snapshot: { target: string; value: RowData; baseVersions: []; meta: null }) => resolveSave(snapshot),
    form: wrapper,
  };
}

describe('config draft form integration', () => {
  it.each(cases)('$name registers actual form edits and preserves them on external updates', async (fixture) => {
    const { form, session } = await mountDraftForm(fixture);
    await form.get('input').setValue('local');
    expect(session.dirty.value).toBe(true);
    expect(useDraftSessionsStore().hasUnsavedWorkForMod('M:/mod')).toBe(true);
    const local = deepClone(session.draftValue.value);
    session.applyExternalForTarget({
      target: 'target',
      value: fixture.initial,
      baseVersions: [{ path: 'target', fingerprint: 'new' }],
      meta: null,
    });
    expect(session.draftValue.value).toEqual(local);
    expect(session.hasPendingExternalValue.value).toBe(true);
    session.loadPendingExternal();
    expect(session.dirty.value).toBe(false);
    expect(useDraftSessionsStore().hasUnsavedWorkForMod('M:/mod')).toBe(false);
  });

  it.each(cases)('$name retains edits made during saving and uses the written baseline', async (fixture) => {
    const { form, session, save, resolveSave } = await mountDraftForm(fixture);
    await form.get('input').setValue('saved');
    const pending = session.saveDraft();
    const submitted = save.mock.calls[0]![1] as RowData;
    await form.get('input').setValue('later');
    resolveSave({ target: 'target', value: submitted, baseVersions: [], meta: null });
    await pending;
    expect((form.get('input').element as HTMLInputElement).value).toBe('later');
    expect(session.dirty.value).toBe(true);
    await form.get('input').setValue('base');
    expect(session.dirty.value).toBe(true);
    session.resetDraft();
    expect(session.draftValue.value).toEqual(submitted);
    expect(session.dirty.value).toBe(false);
  });
});
