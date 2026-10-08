import { csvDraftRow } from '@/test/csv-row';
import { describe, expect, it } from 'vitest';
import type { CsvTableRows, RowData } from '@/shared/types';
import { createCsvGridModel } from './csv-grid-model';

function loadedRows(count: number, fill: (index: number) => RowData): CsvTableRows {
  return Array.from({ length: count }, (_, index) => csvDraftRow(fill(index), `key-${index}`, index));
}

describe('createCsvGridModel rows', () => {
  it('creates loaded row slots with row keys for existing rows', () => {
    const model = createCsvGridModel(
      'ships',
      ['id'],
      loadedRows(2, (index) => ({ id: `s${index}` })),
      2,
    );
    expect(model.rows).toHaveLength(2);
    expect(model.rows[0]!).toEqual({ ...csvDraftRow({ id: 's0' }, 'key-0', 0), kind: 'row', rowIndex: 0 });
    expect(model.rows[1]!).toEqual({ ...csvDraftRow({ id: 's1' }, 'key-1', 1), kind: 'row', rowIndex: 1 });
  });

  it('creates placeholder slots with stable table-scoped keys beyond the loaded rows', () => {
    const model = createCsvGridModel(
      'ships',
      ['id'],
      loadedRows(1, () => ({ id: 's0' })),
      3,
    );
    expect(model.rows[0]!.kind).toBe('row');
    expect(model.rows[1]!).toEqual({ kind: 'placeholder', rowIndex: 1, slotKey: 'ships:slot:1' });
    expect(model.rows[2]!).toEqual({ kind: 'placeholder', rowIndex: 2, slotKey: 'ships:slot:2' });
  });

  it('reports the row count through the performance sample', () => {
    const model = createCsvGridModel(
      'ships',
      ['id'],
      loadedRows(4, () => ({ id: 'x' })),
      4,
    );
    expect(model.performanceSample.table).toBe('ships');
    expect(model.performanceSample.rows).toBe(4);
    expect(model.performanceSample.columns).toBe(1);
    expect(model.performanceSample.ms).toBeGreaterThanOrEqual(0);
    expect(model.performanceSample.sourceMs).toBeGreaterThanOrEqual(0);
    expect(model.performanceSample.widthMs).toBeGreaterThanOrEqual(0);
  });
});

describe('createCsvGridModel columns', () => {
  it('resolves the registered column schema and enum options', () => {
    const model = createCsvGridModel('ships', ['shield type'], [], 0);
    expect(model.columns).toHaveLength(1);
    expect(model.columns[0]!.key).toBe('shield type');
    expect(model.columns[0]!.schema?.control).toBe('enum');
    expect(model.columns[0]!.className).toBe('schema-col-enum');
    expect(model.columns[0]!.enumOptions.map((option) => option.value)).toEqual(['NONE', 'FRONT', 'OMNI', 'PHASE']);
  });

  it('falls back to the text control for unregistered columns', () => {
    const model = createCsvGridModel('ships', ['not-in-schema'], [], 0);
    expect(model.columns[0]!.schema).toBeNull();
    expect(model.columns[0]!.className).toBe('schema-col-text');
    expect(model.columns[0]!.enumOptions).toEqual([]);
  });

  it('keeps text column widths inside the text clamp range', () => {
    const longName = 'x'.repeat(80);
    const model = createCsvGridModel(
      'ships',
      ['name'],
      loadedRows(1, () => ({ name: longName })),
      1,
    );
    const width = model.columns[0]!.widthPx;
    expect(width).toBeGreaterThanOrEqual(64);
    expect(width).toBeLessThanOrEqual(260);
    expect(model.totalWidthPx).toBe(width);
  });

  it('keeps enum column widths inside the enum clamp range', () => {
    const model = createCsvGridModel('ships', ['shield type'], [], 0);
    expect(model.columns[0]!.widthPx).toBeGreaterThanOrEqual(88);
    expect(model.columns[0]!.widthPx).toBeLessThanOrEqual(240);
  });

  it('keeps tag column widths inside the tag clamp range', () => {
    const model = createCsvGridModel(
      'ships',
      ['tags'],
      loadedRows(1, () => ({ tags: 'a,b,c,d,e' })),
      1,
    );
    expect(model.columns[0]!.widthPx).toBeGreaterThanOrEqual(160);
    expect(model.columns[0]!.widthPx).toBeLessThanOrEqual(560);
  });

  it('sums every column width into totalWidthPx', () => {
    const model = createCsvGridModel('ships', ['name', 'id', 'shield type'], [], 0);
    expect(model.totalWidthPx).toBe(model.columns.reduce((sum, column) => sum + column.widthPx, 0));
  });
});
