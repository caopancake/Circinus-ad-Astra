import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as query from './query-api';
import * as files from './files-api';
import * as write from './write-api';
import { entityTargetFixture } from '@/test/entity-target';
import type {
  DeleteIndexedConfigEntityWrite,
  DeleteSkinEntityWrite,
  DeleteVariantEntityWrite,
  IndexedConfigEntityWrite,
  SkinEntityWrite,
  VariantEntityWrite,
} from '@/shared/types';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const sessionId = 's1',
  modRoot = 'M:/mod',
  id = 'demo',
  path = 'M:/mod/demo.ship';
const target = entityTargetFixture('ship', id);
const data = { hullId: id, _business: { key: '0012' } };
const jsonWrite = { preserveOriginalJson: true, confirmedSources: [] };
const indexed: IndexedConfigEntityWrite = {
  sessionId,
  modRoot,
  baseVersions: [],
  kind: 'mission',
  previousId: null,
  nextId: id,
  indexRow: { mission: id },
  entityData: { descriptor: { title: 'Demo' }, text: '' },
};
const deleteIndexed: DeleteIndexedConfigEntityWrite = { sessionId, modRoot, baseVersions: [], kind: 'mission', id, deleteTarget: true };
const family: VariantEntityWrite & SkinEntityWrite = {
  sessionId,
  modRoot,
  baseVersions: [],
  previousId: null,
  nextId: id,
  relPath: null,
  data,
};
const deleteFamily: DeleteVariantEntityWrite & DeleteSkinEntityWrite = {
  sessionId,
  modRoot,
  baseVersions: [],
  relPath: 'data/variants/demo.variant',
  entityId: id,
};
const cases: Array<[string, () => Promise<unknown>, object]> = [
  [
    'query_csv_table_window',
    () => query.queryCsvTableWindow(sessionId, 'ships', 0, 240, null, { kind: 'all' }),
    { sessionId, table: 'ships', start: 0, count: 240, search: null, faction: { kind: 'all' } },
  ],
  ['query_csv_source_options', () => query.queryCsvSourceOptions(sessionId, 'ships'), { sessionId, source: 'ships' }],
  ['query_csv_row_preview', () => query.queryCsvRowPreview(sessionId, 'ships', 'r1'), { sessionId, table: 'ships', rowKey: 'r1' }],
  ['query_hull_references', () => query.queryHullReferences(sessionId, [id]), { sessionId, referenceIds: [id] }],
  ['query_entity', () => query.queryEntity(sessionId, 'ship', id), { sessionId, kind: 'ship', id }],
  ['query_entity_edit_target', () => query.queryEntityEditTarget(sessionId, 'ship', id), { sessionId, kind: 'ship', id }],
  [
    'query_entity_identity_intent',
    () => query.queryEntityIdentityIntent(sessionId, target, 'next'),
    { sessionId, source: target, nextId: 'next' },
  ],
  ['query_entity_list', () => query.queryEntityList(sessionId, 'ship'), { sessionId, kind: 'ship' }],
  [
    'query_editor_draft_resources',
    () => query.queryEditorDraftResources(sessionId, 'ship', id, data),
    { sessionId, kind: 'ship', id, draft: data },
  ],
  ['query_resource_data_urls', () => query.queryResourceDataUrlBatch(sessionId, []), { sessionId, resources: [] }],
  ['resolve_mod_relative_path', () => query.resolveModRelativePath(sessionId, modRoot, path), { sessionId, modRoot, absolutePath: path }],
  ['load_editable_file', () => files.loadEditableFile(null, modRoot, path), { sessionId: null, modRoot, path }],
  ['load_imported_editor_spec_file', () => files.loadImportedEditorSpecFile('ship', path), { kind: 'ship', path }],
  ['query_text_identity_intent', () => files.queryTextIdentityIntent(sessionId, target, '{}'), { sessionId, source: target, text: '{}' }],
  ['follow_text_identity', () => files.followTextIdentity('ship', '{}', id), { kind: 'ship', text: '{}', nextId: id }],
  [
    'save_csv_patch',
    () => write.saveCsvPatch(sessionId, modRoot, 'ships', [], [], jsonWrite),
    { sessionId, modRoot, table: 'ships', patches: [], associatedSpecs: [], jsonWrite, baseVersions: [] },
  ],
  [
    'save_text_file',
    () => write.saveTextFile(null, modRoot, path, '0012'),
    { sessionId: null, modRoot, path, text: '0012', baseVersions: [] },
  ],
  [
    'transcode_file_to_utf8',
    () => write.transcodeFileToUtf8(null, modRoot, path, 'gb18030'),
    { sessionId: null, modRoot, path, encoding: 'gb18030', baseVersions: [] },
  ],
  [
    'save_editor_spec',
    () => write.saveEditorSpec(sessionId, modRoot, target, data, jsonWrite),
    { sessionId, modRoot, target, data, jsonWrite, orderedJson: JSON.stringify(data), baseVersions: [] },
  ],
  [
    'save_mod_info',
    () => write.saveModInfo(sessionId, modRoot, data, jsonWrite),
    { sessionId, modRoot, data, jsonWrite, orderedJson: JSON.stringify(data), baseVersions: [] },
  ],
  ['save_mod_files', () => write.saveModFiles(sessionId, modRoot, []), { sessionId, modRoot, files: [], baseVersions: [] }],
  [
    'apply_file_change_set',
    () => write.applyFileChangeSet(sessionId, modRoot, 'undo', 1, 2),
    { sessionId, modRoot, direction: 'undo', entryId: 1, revision: 2 },
  ],
  ['query_file_history', () => write.queryFileHistory(sessionId, modRoot), { sessionId, modRoot }],
  ['clear_file_history', () => write.clearFileHistory(sessionId, modRoot), { sessionId, modRoot }],
  [
    'save_indexed_config_entity',
    () => write.saveIndexedConfigEntity(indexed, jsonWrite),
    { ...indexed, jsonWrite, orderedJson: JSON.stringify(indexed.entityData.descriptor) },
  ],
  ['create_indexed_config_entity', () => write.createIndexedConfigEntity(indexed), indexed],
  ['delete_indexed_config_entity', () => write.deleteIndexedConfigEntity(deleteIndexed), deleteIndexed],
  ['save_variant_entity', () => write.saveVariantEntity(family, jsonWrite), { ...family, jsonWrite, orderedJson: JSON.stringify(data) }],
  ['create_variant_entity', () => write.createVariantEntity(family), family],
  ['delete_variant_entity', () => write.deleteVariantEntity(deleteFamily), deleteFamily],
  ['save_skin_entity', () => write.saveSkinEntity(family, jsonWrite), { ...family, jsonWrite, orderedJson: JSON.stringify(data) }],
  ['create_skin_entity', () => write.createSkinEntity(family), family],
  ['delete_skin_entity', () => write.deleteSkinEntity(deleteFamily), deleteFamily],
];
beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue({ ready: true });
});
describe('query and persistence transport protocols', () => {
  it.each(cases)('%s preserves its wire protocol', async (command, action, payload) => {
    const result = await action();
    expect(result).toEqual({ ready: true });
    expect(invoke).toHaveBeenCalledExactlyOnceWith(command, { payload });
  });
});
