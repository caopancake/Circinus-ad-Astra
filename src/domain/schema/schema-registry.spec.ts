import { describe, expect, it } from 'vitest';
import { CSV_COLUMN_CONTROLS, FIELD_TYPE_SET, type FileSchema } from './schema.types';
import { getCsvColumnSchemas, getSchema } from './schema-registry';
import { TABLE_KEYS } from '@/shared/types';

const SPEC_IDS = ['mod-info', 'faction', 'mission', 'skin', 'variant'];

describe('schema registry', () => {
  it('loads every bundled spec schema in the unified field-schema/v1 shape', () => {
    for (const id of SPEC_IDS) {
      const schema = getSchema(id);
      expect(schema, id).not.toBeNull();
      expect(schema?.$schema).toBe('circinus-ad-astra/field-schema/v1');
      expect(schema?.id).toBe(id);
      expect(schema?.sections?.length).toBeGreaterThan(0);
      for (const section of schema?.sections ?? []) {
        expect(section.id.length).toBeGreaterThan(0);
        expect(section.label.length).toBeGreaterThan(0);
        expect(section.fields.length).toBeGreaterThan(0);
      }
    }
  });

  it('preserves sources only on schemas that declare them', () => {
    expect(getSchema('mod-info')?.sources?.length).toBeGreaterThan(0);
    expect(getSchema('faction')?.sources?.length).toBeGreaterThan(0);
    expect(getSchema('mission')?.sources?.length).toBe(3);
    expect(getSchema('variant')?.sources).toBeUndefined();
    expect(getSchema('skin')?.sources).toBeUndefined();
  });

  it('keeps every field inside the closed field type set', () => {
    for (const id of SPEC_IDS) {
      const schema: FileSchema | null = getSchema(id);
      for (const section of schema?.sections ?? []) {
        for (const field of section.fields) {
          expect(FIELD_TYPE_SET.has(field.type), `${id} ${field.key}`).toBe(true);
          expect(field.key.length).toBeGreaterThan(0);
          expect(field.label.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('returns null for unknown schema ids', () => {
    expect(getSchema('does-not-exist')).toBeNull();
  });

  it('loads column schemas for every registered csv table with valid controls', () => {
    expect(TABLE_KEYS.length).toBeGreaterThan(0);
    for (const table of TABLE_KEYS) {
      for (const column of getCsvColumnSchemas(table)) {
        expect(column.key.length).toBeGreaterThan(0);
        expect(CSV_COLUMN_CONTROLS).toContain(column.control);
      }
    }
    expect(getCsvColumnSchemas('ships').length).toBeGreaterThan(0);
  });
});
