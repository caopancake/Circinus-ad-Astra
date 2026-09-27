import { describe, expect, it } from 'vitest';
import type { RowData, TableKey } from '@/shared/types';
import { isCsvCommentRow } from './csv-comment-row';

describe('isCsvCommentRow', () => {
  it('returns false for missing rows', () => {
    expect(isCsvCommentRow(null, 'ships')).toBe(false);
    expect(isCsvCommentRow(undefined, 'ships')).toBe(false);
  });

  it('detects hash-prefixed display ids', () => {
    expect(isCsvCommentRow({ id: '#disabled' }, 'ships')).toBe(true);
    expect(isCsvCommentRow({ hullId: ' #note' }, 'ships')).toBe(true);
  });

  it('detects hash-prefixed values in any column', () => {
    expect(isCsvCommentRow({ name: 'ok', designation: '#removed' }, 'ships')).toBe(true);
  });

  it('returns false for plain data rows', () => {
    const row: RowData = { id: 'XY', name: 'Ship', tags: 'a,b' };
    expect(isCsvCommentRow(row, 'ships')).toBe(false);
  });

  it('does not treat hashes inside values as comments', () => {
    expect(isCsvCommentRow({ id: 'C#note' }, 'ships')).toBe(false);
  });

  it('accepts every registered table key without special cases', () => {
    const tables: TableKey[] = ['ships', 'weapons', 'wings', 'skills'];
    for (const table of tables) {
      expect(isCsvCommentRow({ id: '#x' }, table)).toBe(true);
      expect(isCsvCommentRow({ id: 'x' }, table)).toBe(false);
    }
  });
});
