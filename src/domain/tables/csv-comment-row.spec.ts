import { describe, expect, it } from 'vitest';
import type { CsvRow } from '@/shared/types';
import { isCsvCommentRow } from './csv-comment-row';

describe('isCsvCommentRow', () => {
  it('returns false for missing rows', () => {
    expect(isCsvCommentRow(null)).toBe(false);
    expect(isCsvCommentRow(undefined)).toBe(false);
  });

  it.each<CsvRow>([
    { data: { name: '#disabled', id: 'active' }, isComment: true },
    { data: { name: '#quoted', id: 'active' }, isComment: false },
    { data: { name: ' #space' }, isComment: false },
    { data: { name: '\t#tab' }, isComment: false },
    { data: { name: 'active', id: '#later' }, isComment: false },
  ])('consumes the parser-owned flag for $data', (row) => {
    expect(isCsvCommentRow(row)).toBe(row.isComment);
  });
});
