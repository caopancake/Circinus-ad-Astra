import { stableStringify } from '@/shared/lib/stable-compare';
import type { FileSchema, SectionSchema } from '@/domain/schema/schema.types';

export function getSchemaSections(schema: FileSchema): SectionSchema[] {
  return schema.sections ?? [];
}

export function getSchemaFieldKeys(schema: FileSchema): string[] {
  const sections = getSchemaSections(schema);
  const keys: string[] = [];
  for (const section of sections) {
    for (const field of section.fields) {
      keys.push(field.key);
    }
  }
  return keys;
}

export function isMultiSourceSchema(schema: FileSchema): boolean {
  return Boolean(schema.sources?.length);
}

export function getExtraFieldSource(schema: FileSchema): string | null {
  return schema.sources?.find((source) => source.extraFields)?.id ?? null;
}

export function schemaSectionCollapseIdentity(schema: FileSchema): string {
  return stableStringify([schema.id, getSchemaSections(schema).map((section) => [section.id, section.collapsed])]);
}
