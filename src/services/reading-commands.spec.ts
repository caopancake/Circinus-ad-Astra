import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryTableWindow, querySessionCsvRowPreview } from './csv-table.service';
import { querySourceOptionCatalog } from './source-options.service';
import { querySessionHullReferences } from './hull-reference.service';
import {
  querySessionEntity,
  querySessionEntityList,
  querySessionEntityEditTarget,
  querySessionEntityIdentityIntent,
  querySessionEditorDraftResources,
} from './entity-query.service';
import { queryResourceDataUrls, invalidateResourceCacheForSession } from './resource-cache.service';
import { resolveModImageReference } from './resource-reference.service';
import { invalidateQueryCacheForSession } from './query-cache.service';
import { entityTargetFixture } from '@/test/entity-target';
import { toConfigFamilyRecord } from '@/domain/config/config-records';
import type { EntityData, ResourceRef, QueryIdentity, QueryValue } from '@/shared/types';
import { expectTypeOf } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const sessionId = 'read-protocols';
const target = entityTargetFixture('ship', 'demo');
const draft = { hullId: 'demo' };
const resource: ResourceRef = { source: 'mod', relPath: 'graphics/demo.png', ownerKind: 'ship', ownerId: 'demo', key: 'sprite' };
const cases: Array<[string, () => Promise<unknown>, object, unknown]> = [
  [
    'query_csv_table_window',
    () => queryTableWindow(sessionId, 'ships', 0, 240, null, { kind: 'all' }),
    { sessionId, table: 'ships', start: 0, count: 240, search: null, faction: { kind: 'all' } },
    { rows: [] },
  ],
  [
    'query_csv_row_preview',
    () => querySessionCsvRowPreview(sessionId, 'ships', 'row'),
    { sessionId, table: 'ships', rowKey: 'row' },
    { resourceRef: null },
  ],
  ['query_csv_source_options', () => querySourceOptionCatalog(sessionId, 'csv:ships.name'), { sessionId, source: 'csv:ships.name' }, []],
  [
    'query_hull_references',
    () => querySessionHullReferences(sessionId, ['b', 'a', 'b']),
    { sessionId, referenceIds: ['a', 'b'] },
    { groups: [], hullNames: {}, sprites: {}, builtInWeaponSlots: {} },
  ],
  ['query_entity', () => querySessionEntity(sessionId, 'ship', 'demo'), { sessionId, kind: 'ship', id: 'demo' }, null],
  ['query_entity_list', () => querySessionEntityList(sessionId, 'ship'), { sessionId, kind: 'ship' }, []],
  [
    'query_entity_edit_target',
    () => querySessionEntityEditTarget(sessionId, 'ship', 'demo'),
    { sessionId, kind: 'ship', id: 'demo' },
    { target, baseVersions: [] },
  ],
  [
    'query_entity_identity_intent',
    () => querySessionEntityIdentityIntent(sessionId, target, 'next'),
    { sessionId, source: target, nextId: 'next' },
    { destinationVersion: {} },
  ],
  [
    'query_editor_draft_resources',
    () => querySessionEditorDraftResources(sessionId, 'ship', 'demo', draft),
    { sessionId, kind: 'ship', id: 'demo', draft },
    {},
  ],
  [
    'query_resource_data_urls',
    () => queryResourceDataUrls(sessionId, [resource]),
    { sessionId, resources: [resource] },
    { entries: [{ ...resource, dataUrl: null }] },
  ],
  [
    'resolve_mod_relative_path',
    () => resolveModImageReference(sessionId, 'M:/mod', 'M:/mod/image.png'),
    { sessionId, modRoot: 'M:/mod', absolutePath: 'M:/mod/image.png' },
    'image.png',
  ],
];

beforeEach(() => invoke.mockReset());
afterEach(() => {
  invalidateQueryCacheForSession(sessionId);
  invalidateResourceCacheForSession(sessionId);
});

describe('formal reading protocols', () => {
  it('captures live draft parameters once and sends that captured snapshot to the command', async () => {
    let reads = 0;
    const nested = { path: 'graphics/original.png' };
    const input = {
      hullId: 'demo',
      get sprite() {
        reads++;
        return nested;
      },
    };
    invoke.mockResolvedValue({});
    const pending = querySessionEditorDraftResources(sessionId, 'ship', 'demo', input);
    nested.path = 'graphics/later.png';
    const args = invoke.mock.lastCall![1] as { payload: { draft: { sprite: { path: string } } } };
    expect(args.payload.draft.sprite.path).toBe('graphics/original.png');
    expect(reads).toBe(1);
    await pending;
  });
  it.each([
    ['csv-table-window', 80],
    ['csv-source-options', 240],
    ['csv-row-preview', 400],
    ['hull-references', 128],
    ['entity-detail', 128],
    ['entity-list', 128],
  ] as const)('%s enforces its capacity and retains recently accessed results', async (kind, capacity) => {
    const read = (session: string) => {
      switch (kind) {
        case 'csv-table-window':
          return queryTableWindow(session, 'ships', 0, 240, null, { kind: 'all' });
        case 'csv-source-options':
          return querySourceOptionCatalog(session, 'csv:ships.id');
        case 'csv-row-preview':
          return querySessionCsvRowPreview(session, 'ships', 'row');
        case 'hull-references':
          return querySessionHullReferences(session, ['demo']);
        case 'entity-detail':
          return querySessionEntity(session, 'ship', 'demo');
        case 'entity-list':
          return querySessionEntityList(session, 'ship');
      }
    };
    invoke.mockResolvedValue(kind === 'entity-detail' ? null : []);
    const sessions = Array.from({ length: capacity + 1 }, (_, i) => `${kind}-capacity-${i}`);
    for (const session of sessions.slice(0, capacity)) await read(session);
    await read(sessions[0]!);
    await read(sessions[capacity]!);
    await read(sessions[1]!);
    await read(sessions[0]!);
    expect(invoke).toHaveBeenCalledTimes(capacity + 2);
    for (const session of sessions) invalidateQueryCacheForSession(session);
  });
  it.each(cases)('%s maps its protocol and returns its formal content', async (command, read, payload, value) => {
    invoke.mockResolvedValue(value);
    const actual = await read();
    expect(actual).toEqual(command === 'query_resource_data_urls' ? [null] : value);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(command, { payload });
  });

  it('shares equivalent Hull reference sets through the actual command', async () => {
    invoke.mockResolvedValue({ groups: [], hullNames: { a: 'A' }, sprites: {}, builtInWeaponSlots: {} });
    const first = await querySessionHullReferences(sessionId, ['b', 'a', 'a']);
    expect(await querySessionHullReferences(sessionId, ['a', 'b'])).toBe(first);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('isolates editable records from shared cached entity content and versions', async () => {
    const entity: EntityData = {
      kind: 'ship',
      id: 'demo',
      target,
      baseVersions: [{ path: 'M:/mod/demo.ship', fingerprint: 'v1' }],
      data: { nested: { title: 'Original' } },
      resourceRefs: {},
    };
    invoke.mockResolvedValue(entity);
    const shared = (await querySessionEntity(sessionId, 'ship', 'demo'))!;
    const editable = toConfigFamilyRecord(shared);
    editable.file.data.nested = { title: 'Edited' };
    editable.file.baseVersions[0]!.fingerprint = 'edited';
    const repeated = await querySessionEntity(sessionId, 'ship', 'demo');
    expect(repeated?.data).toEqual({ nested: { title: 'Original' } });
    expect(repeated?.baseVersions[0]?.fingerprint).toBe('v1');
    expect(invoke).toHaveBeenCalledOnce();
    expectTypeOf<ReturnType<typeof querySessionEntity>>().toEqualTypeOf<Promise<QueryValue<'entity-detail'>>>();
    expectTypeOf<QueryIdentity<'csv-row-preview'>['parameters']>().toEqualTypeOf<{
      table: import('@/shared/types').TableKey;
      rowKey: string;
    }>();
  });
});
