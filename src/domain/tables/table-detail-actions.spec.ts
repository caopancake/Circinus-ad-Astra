import { describe, expect, it } from 'vitest';
import type { RowData } from '@/shared/types';
import { detailActionKey, detailActionLabel, detailActionsForRow } from './table-detail-actions';

const context = { modRoot: 'C:/mods/alpha', sessionId: 's1', starsectorRoot: null };

describe('detailActionsForRow', () => {
  it('returns no actions without a row', () => {
    expect(detailActionsForRow(context, 'ships', null)).toEqual([]);
    expect(detailActionsForRow(context, 'ships', undefined)).toEqual([]);
  });

  it('returns no actions for comment rows', () => {
    expect(detailActionsForRow(context, 'ships', { id: '#note' })).toEqual([]);
  });

  it('returns no actions for rows without a spec id', () => {
    expect(detailActionsForRow(context, 'ships', { name: 'orphan' })).toEqual([]);
  });

  it('returns the ship editor and the spec file editor for ship rows', () => {
    const actions = detailActionsForRow(context, 'ships', { id: 'XY' });
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      type: 'editor-window',
      kind: 'ship',
      id: 'XY',
      modRoot: context.modRoot,
      sessionId: context.sessionId,
    });
    expect(actions[1]).toMatchObject({ type: 'file-editor', path: 'C:/mods/alpha\\data\\hulls\\XY.ship' });
  });

  it('returns both weapon editors plus the file editor for weapon rows', () => {
    const actions = detailActionsForRow(context, 'weapons', { id: 'railgun' });
    expect(actions.map((action) => (action.type === 'editor-window' ? action.kind : 'file'))).toEqual(['weapon', 'weapon-preview', 'file']);
  });

  it('returns only the file editor for skills rows without editor windows', () => {
    const actions = detailActionsForRow(context, 'skills', { id: 'helmanship' });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'file-editor', path: 'C:/mods/alpha\\data\\characters\\skills\\helmanship.skill' });
  });

  it('returns no actions for tables without associated specs', () => {
    const row: RowData = { id: 'wing1' };
    expect(detailActionsForRow(context, 'wings', row)).toEqual([]);
  });
});

describe('detail action labels and keys', () => {
  const actions = detailActionsForRow(context, 'ships', { id: 'XY' });

  it('labels editor windows with their editor window label', () => {
    expect(detailActionLabel(actions[0]!)).toBe('舰船编辑器');
    expect(detailActionLabel(actions[1]!)).toBe('文件编辑器');
  });

  it('builds distinct stable keys from the action identity', () => {
    expect(detailActionKey(actions[0]!)).not.toBe(detailActionKey(actions[1]!));
    const again = detailActionsForRow(context, 'ships', { id: 'XY' });
    expect(detailActionKey(again[0]!)).toBe(detailActionKey(actions[0]!));
  });
});
