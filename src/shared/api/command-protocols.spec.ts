import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as files from './files-api';
import * as csvTable from '@/services/csv-table.service';
import * as configEntity from '@/services/config-entity.service';
import * as editor from '@/services/editor.service';
import * as fileHistory from '@/services/file-history.service';
import * as fileService from '@/services/files.service';
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
  ['load_editable_file', () => files.loadEditableFile(null, modRoot, path), { sessionId: null, modRoot, path }],
  ['load_imported_editor_spec_file', () => editor.loadImportedSpecFile('ship', path), { kind: 'ship', path }],
  ['query_text_identity_intent', () => files.queryTextIdentityIntent(sessionId, target, '{}'), { sessionId, source: target, text: '{}' }],
  ['follow_text_identity', () => files.followTextIdentity('ship', '{}', id), { kind: 'ship', text: '{}', nextId: id }],
  [
    'save_csv_patch',
    () => csvTable.saveCsvPatch(sessionId, modRoot, 'ships', [], [], jsonWrite),
    { sessionId, modRoot, table: 'ships', patches: [], associatedSpecs: [], jsonWrite, baseVersions: [] },
  ],
  [
    'save_text_file',
    () => fileService.writeEditableFileText(null, modRoot, path, '0012', []),
    { sessionId: null, modRoot, path, text: '0012', baseVersions: [] },
  ],
  [
    'transcode_file_to_utf8',
    () => fileService.transcodeFileToUtf8(null, modRoot, path, 'gb18030'),
    { sessionId: null, modRoot, path, encoding: 'gb18030', baseVersions: [] },
  ],
  [
    'save_editor_spec',
    () => editor.saveEditorSpec(sessionId, modRoot, target, data, jsonWrite),
    { sessionId, modRoot, target, data, jsonWrite, orderedJson: JSON.stringify(data), baseVersions: [] },
  ],
  [
    'save_mod_info',
    () => configEntity.saveModInfo(sessionId, modRoot, data, jsonWrite),
    { sessionId, modRoot, data, jsonWrite, orderedJson: JSON.stringify(data), baseVersions: [] },
  ],
  ['save_mod_files', () => fileService.saveModFiles(sessionId, modRoot, []), { sessionId, modRoot, files: [], baseVersions: [] }],
  [
    'apply_file_change_set',
    () => fileHistory.replayFileChangeSet(sessionId, modRoot, 'undo', 1, 2),
    { sessionId, modRoot, direction: 'undo', entryId: 1, revision: 2 },
  ],
  ['query_file_history', () => fileHistory.loadFileHistory(sessionId, modRoot), { sessionId, modRoot }],
  ['clear_file_history', () => fileHistory.clearSavedFileHistory(sessionId, modRoot), { sessionId, modRoot }],
  [
    'save_indexed_config_entity',
    () => configEntity.saveIndexedConfigEntity(indexed, jsonWrite),
    { ...indexed, jsonWrite, orderedJson: JSON.stringify(indexed.entityData.descriptor) },
  ],
  ['create_indexed_config_entity', () => configEntity.createIndexedConfigEntity(indexed), indexed],
  ['delete_indexed_config_entity', () => configEntity.deleteIndexedConfigEntity(deleteIndexed), deleteIndexed],
  [
    'save_variant_entity',
    () => configEntity.saveVariantEntity(family, jsonWrite),
    { ...family, jsonWrite, orderedJson: JSON.stringify(data) },
  ],
  ['create_variant_entity', () => configEntity.createVariantEntity(family), family],
  ['delete_variant_entity', () => configEntity.deleteVariantEntity(deleteFamily), deleteFamily],
  ['save_skin_entity', () => configEntity.saveSkinEntity(family, jsonWrite), { ...family, jsonWrite, orderedJson: JSON.stringify(data) }],
  ['create_skin_entity', () => configEntity.createSkinEntity(family), family],
  ['delete_skin_entity', () => configEntity.deleteSkinEntity(deleteFamily), deleteFamily],
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
