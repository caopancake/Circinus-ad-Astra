import { describe, expect, it } from 'vitest';
import { csvSearchOptions, csvSearchPlaceholder, DEFAULT_CSV_SEARCH_FIELD } from './csv-search';

describe('CSV search field projection', () => {
  it('offers the four declared fields in order and defaults to ID/name', () => {
    expect(DEFAULT_CSV_SEARCH_FIELD).toBe('id-name');
    expect(csvSearchOptions('ships', ['tags', 'name', 'id', 'description'])).toEqual([
      { label: 'ID/名称', value: 'id-name' },
      { label: 'ID', value: 'id' },
      { label: '名称', value: 'name' },
      { label: 'tags', value: 'tags' },
    ]);
  });
  it.each([
    ['ships', ['id'], ['id-name', 'id']],
    ['ships', ['name', 'tags'], ['id-name', 'name', 'tags']],
    ['simOpponents', ['variant id'], ['id-name', 'id']],
    ['simOpponents', ['id'], []],
    ['descriptions', ['id', 'text1'], ['id-name', 'id']],
    ['ships', [], []],
  ] as const)('projects %s options only from the actual header %j', (table, header, expected) => {
    expect(csvSearchOptions(table, header).map((option) => option.value)).toEqual(expected);
  });
  it('projects each field into its search prompt', () => {
    expect(['id-name', 'id', 'name', 'tags'].map((field) => csvSearchPlaceholder(field as typeof DEFAULT_CSV_SEARCH_FIELD))).toEqual([
      '搜索 ID/名称',
      '搜索 ID',
      '搜索 名称',
      '搜索 tags',
    ]);
  });
});
