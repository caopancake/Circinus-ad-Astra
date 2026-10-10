import type { CsvSearchField, TableKey } from '@/shared/types';

export const DEFAULT_CSV_SEARCH_FIELD: CsvSearchField = 'id-name';

const SEARCH_LABELS: Record<CsvSearchField, string> = {
  'id-name': 'ID/名称',
  id: 'ID',
  name: '名称',
  tags: 'tags',
};

export function csvSearchOptions(table: TableKey, header: readonly string[]): Array<{ label: string; value: CsvSearchField }> {
  const idField = table === 'simOpponents' ? 'variant id' : 'id';
  const fields: CsvSearchField[] = [];
  if (header.includes(idField) || header.includes('name')) fields.push('id-name');
  if (header.includes(idField)) fields.push('id');
  if (header.includes('name')) fields.push('name');
  if (header.includes('tags')) fields.push('tags');
  return fields.map((value) => ({ label: SEARCH_LABELS[value], value }));
}

export function csvSearchPlaceholder(field: CsvSearchField): string {
  return `搜索 ${SEARCH_LABELS[field]}`;
}
