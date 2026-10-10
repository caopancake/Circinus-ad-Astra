import { describe, expect, it } from 'vitest';
import { CSV_COLUMN_CONTROLS, FIELD_TYPE_SET, type FileSchema } from './schema.types';
import { getCsvColumnSchemas, getSchema } from './schema-registry';
import { TABLE_KEYS } from '@/shared/types';

const SPEC_IDS = ['mod-info', 'faction', 'mission', 'skin', 'variant'];

describe('schema registry', () => {
  it('offers only game weapon group modes in variant editing', () => {
    const weaponGroups = getSchema('variant')!
      .sections!.flatMap((section) => section.fields)
      .find((field) => field.key === 'weaponGroups')!;
    expect(weaponGroups.nested!.find((field) => field.key === 'mode')!.options).toEqual(['LINKED', 'ALTERNATING']);
  });
  it('offers only game fighter formations in wing editing', () => {
    const wings = getCsvColumnSchemas('wings').find((column) => column.key === 'formation');
    expect(wings?.options).toEqual(['CLAW', 'V', 'BOX', 'DIAMOND']);
  });
  it('offers every game weapon slot type in skin editing', () => {
    const weaponSlotChanges = getSchema('skin')!
      .sections!.flatMap((section) => section.fields)
      .find((field) => field.key === 'weaponSlotChanges')!;
    expect(weaponSlotChanges.valueSchema!.nested!.find((field) => field.key === 'type')!.options).toEqual([
      'BALLISTIC',
      'ENERGY',
      'MISSILE',
      'HYBRID',
      'UNIVERSAL',
      'SYNERGY',
      'COMPOSITE',
      'BUILT_IN',
      'DECORATIVE',
      'SYSTEM',
      'STATION_MODULE',
      'LAUNCH_BAY',
    ]);
  });
  it('models skin engine-slot removals as non-negative indices', () => {
    const removeEngineSlots = getSchema('skin')!
      .sections!.flatMap((section) => section.fields)
      .find((field) => field.key === 'removeEngineSlots')!;
    expect(removeEngineSlots.type).toBe('array');
    expect(removeEngineSlots.item).toMatchObject({ type: 'integer', min: 0 });
  });
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
    for (const id of ['constructor', '__proto__', 'toString']) expect(getSchema(id)).toBeNull();
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
