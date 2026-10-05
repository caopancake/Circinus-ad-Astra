import { describe, expect, it } from 'vitest';
import type { DiscoveredField, FieldSchema, FileSchema } from '@/domain/schema/schema.types';
import { mergeSchemaWithCoreFields } from './schema-core-fields';

function field(key: string, extra: Partial<FieldSchema> = {}): FieldSchema {
  return { key, type: 'string', label: key, ...extra };
}

function schemaFixture(sections: { id: string; fields: FieldSchema[] }[], sources?: FileSchema['sources']): FileSchema {
  return {
    $schema: 'circinus-ad-astra/field-schema/v1',
    id: 'fixture',
    sources,
    sections: sections.map((section) => ({ id: section.id, label: section.id, fields: section.fields })),
  };
}

function discovered(key: string, type: DiscoveredField['type'] = 'string'): DiscoveredField {
  return { key, type, origin: 'core' };
}

describe('mergeSchemaWithCoreFields', () => {
  it('returns the original schema when nothing was discovered', () => {
    const schema = schemaFixture([{ id: 'a', fields: [field('x')] }]);
    expect(mergeSchemaWithCoreFields(schema, [])).toBe(schema);
    expect(mergeSchemaWithCoreFields(schema, undefined as unknown as DiscoveredField[])).toBe(schema);
  });

  it('appends unknown discovered fields to a collapsed core section', () => {
    const schema = schemaFixture([{ id: 'a', fields: [field('x')] }], [{ id: 'fx', type: 'json-file', path: 'f.json' }]);
    const merged = mergeSchemaWithCoreFields(schema, [discovered('newField', 'float')]);
    const sections = merged.sections ?? [];
    const extra = sections.at(-1)!;
    expect(extra.id).toBe('__core_discovered');
    expect(extra.collapsed).toBe(true);
    expect(extra.fields).toHaveLength(1);
    expect(extra.fields[0]).toMatchObject({ key: 'fx.newField', label: 'newField', type: 'float' });
    expect(extra.fields[0]!.description).toContain('starsector-core');
  });

  it('skips fields already declared by the schema sections', () => {
    const schema = schemaFixture([{ id: 'a', fields: [field('known')] }], [{ id: 'fx', type: 'json-file', path: 'f.json' }]);
    const merged = mergeSchemaWithCoreFields(schema, [discovered('known'), discovered('fresh')]);
    const sections = merged.sections ?? [];
    const extra = sections.at(-1)!;
    expect(extra.id).toBe('__core_discovered');
    expect(extra.fields.map((entry) => entry.label)).toEqual(['fresh']);
  });

  it('matches declared nested field keys against discovered dotted keys', () => {
    const parent = field('root', { nested: [field('leaf')] });
    const schema = schemaFixture([{ id: 'a', fields: [parent] }], [{ id: 'fx', type: 'json-file', path: 'f.json' }]);
    const merged = mergeSchemaWithCoreFields(schema, [discovered('root.leaf'), discovered('root.other')]);
    const sections = merged.sections ?? [];
    const extra = sections.at(-1)!;
    expect(extra.fields.map((entry) => entry.label)).toEqual(['root.other']);
  });

  it('returns the original schema when every discovered field is already declared', () => {
    const schema = schemaFixture([{ id: 'a', fields: [field('x')] }], [{ id: 'fx', type: 'json-file', path: 'f.json' }]);
    expect(mergeSchemaWithCoreFields(schema, [discovered('x')])).toBe(schema);
  });

  it('keeps original sections unchanged ahead of the core section', () => {
    const schema = schemaFixture([{ id: 'a', fields: [field('x')] }]);
    const merged = mergeSchemaWithCoreFields(schema, [discovered('y')]);
    expect(merged.sections?.[0]?.fields.map((entry) => entry.key)).toEqual(['x']);
    expect(merged.sections).toHaveLength(2);
    expect((merged.sections ?? []).at(-1)!.label).toContain('1');
  });
});
