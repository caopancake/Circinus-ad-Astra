import type { TableKey } from '@/shared/types';
import { validateSchemaCsvSources } from '@/domain/schema/schema-sources';
import {
  CSV_COLUMN_CONTROL_SET,
  FIELD_TYPE_SET,
  SCHEMA_SOURCE_TYPE_SET,
  type CsvColumnSchema,
  type FieldSchema,
  type FileSchema,
  type SchemaSourceType,
  type SectionSchema,
} from '@/domain/schema/schema.types';

import modInfoSchemaRaw from '../../../schemas/mod-info.schema.json';
import factionSchemaRaw from '../../../schemas/faction.schema.json';
import missionSchemaRaw from '../../../schemas/mission.schema.json';
import skinSchemaRaw from '../../../schemas/skin.schema.json';
import variantSchemaRaw from '../../../schemas/variant.schema.json';
import abilitiesColumnsRaw from '../../../schemas/csv/abilities.schema.json';
import commoditiesColumnsRaw from '../../../schemas/csv/commodities.schema.json';
import descriptionsColumnsRaw from '../../../schemas/csv/descriptions.schema.json';
import hullmodsColumnsRaw from '../../../schemas/csv/hullmods.schema.json';
import industriesColumnsRaw from '../../../schemas/csv/industries.schema.json';
import marketConditionsColumnsRaw from '../../../schemas/csv/marketConditions.schema.json';
import shipSystemsColumnsRaw from '../../../schemas/csv/shipSystems.schema.json';
import shipsColumnsRaw from '../../../schemas/csv/ships.schema.json';
import simOpponentsColumnsRaw from '../../../schemas/csv/simOpponents.schema.json';
import skillsColumnsRaw from '../../../schemas/csv/skills.schema.json';
import specialItemsColumnsRaw from '../../../schemas/csv/specialItems.schema.json';
import submarketsColumnsRaw from '../../../schemas/csv/submarkets.schema.json';
import weaponsColumnsRaw from '../../../schemas/csv/weapons.schema.json';
import wingsColumnsRaw from '../../../schemas/csv/wings.schema.json';

const FIELD_SCHEMA_VERSION = 'circinus-ad-astra/field-schema/v1';
const CSV_COLUMNS_VERSION = 'circinus-ad-astra/csv-columns/v1';

const SCHEMAS: Record<string, FileSchema> = {
  'mod-info': parseFileSchema('mod-info', modInfoSchemaRaw),
  faction: parseFileSchema('faction', factionSchemaRaw),
  mission: parseFileSchema('mission', missionSchemaRaw),
  skin: parseFileSchema('skin', skinSchemaRaw),
  variant: parseFileSchema('variant', variantSchemaRaw),
};

const CSV_COLUMN_SCHEMAS: Record<TableKey, CsvColumnSchema[]> = {
  abilities: parseCsvColumnSchemas('abilities', abilitiesColumnsRaw),
  commodities: parseCsvColumnSchemas('commodities', commoditiesColumnsRaw),
  descriptions: parseCsvColumnSchemas('descriptions', descriptionsColumnsRaw),
  hullmods: parseCsvColumnSchemas('hullmods', hullmodsColumnsRaw),
  industries: parseCsvColumnSchemas('industries', industriesColumnsRaw),
  marketConditions: parseCsvColumnSchemas('marketConditions', marketConditionsColumnsRaw),
  shipSystems: parseCsvColumnSchemas('shipSystems', shipSystemsColumnsRaw),
  ships: parseCsvColumnSchemas('ships', shipsColumnsRaw),
  simOpponents: parseCsvColumnSchemas('simOpponents', simOpponentsColumnsRaw),
  skills: parseCsvColumnSchemas('skills', skillsColumnsRaw),
  specialItems: parseCsvColumnSchemas('specialItems', specialItemsColumnsRaw),
  submarkets: parseCsvColumnSchemas('submarkets', submarketsColumnsRaw),
  weapons: parseCsvColumnSchemas('weapons', weaponsColumnsRaw),
  wings: parseCsvColumnSchemas('wings', wingsColumnsRaw),
};

export function getSchema(id: string): FileSchema | null {
  return Object.hasOwn(SCHEMAS, id) ? SCHEMAS[id]! : null;
}

export function getCsvColumnSchemas(table: TableKey): CsvColumnSchema[] {
  return CSV_COLUMN_SCHEMAS[table] ?? [];
}

// Runtime shape validation: schema assets become typed output only through this entry.

function parseFileSchema(id: string, raw: unknown): FileSchema {
  const asset = asRecord(raw, `schema ${id}`);
  if (asset.$schema !== FIELD_SCHEMA_VERSION) {
    throw new Error(`schema ${id}: $schema 必须是 ${FIELD_SCHEMA_VERSION}`);
  }
  if (typeof asset.id !== 'string' || asset.id.length === 0) {
    throw new Error(`schema ${id}: 缺少 id`);
  }
  const sections = parseSections(id, asset.sections);
  const schema: FileSchema = {
    $schema: FIELD_SCHEMA_VERSION,
    id: asset.id,
    sections,
  };
  if (isString(asset.fileType)) schema.fileType = asset.fileType;
  if (isString(asset.displayName)) schema.displayName = asset.displayName;
  if (isString(asset.description)) schema.description = asset.description;
  if (isString(asset.targetFile)) schema.targetFile = asset.targetFile;
  if (isString(asset.gameVersion)) schema.gameVersion = asset.gameVersion;
  if (asset.sources !== undefined) schema.sources = parseSources(id, asset.sources);
  validateSchemaCsvSources(schema);
  return schema;
}

function parseSections(id: string, raw: unknown): SectionSchema[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`schema ${id}: sections 必须是非空数组`);
  }
  return raw.map((section, index) => {
    const record = asRecord(section, `schema ${id} sections[${index}]`);
    if (typeof record.id !== 'string' || typeof record.label !== 'string') {
      throw new Error(`schema ${id} sections[${index}]: 缺少 id/label`);
    }
    const collapsed = record.collapsed === true ? { collapsed: true } : {};
    return {
      id: record.id,
      label: record.label,
      ...collapsed,
      fields: parseFields(id, `sections[${index}].fields`, record.fields),
    };
  });
}

function parseFields(id: string, path: string, raw: unknown): FieldSchema[] {
  if (!Array.isArray(raw)) {
    throw new Error(`schema ${id}: ${path} 必须是数组`);
  }
  return raw.map((field, index) => parseField(id, `${path}[${index}]`, field));
}

function parseField(id: string, path: string, raw: unknown): FieldSchema {
  const record = asRecord(raw, `schema ${id} ${path}`);
  if (typeof record.key !== 'string' || typeof record.label !== 'string') {
    throw new Error(`schema ${id} ${path}: 缺少 key/label`);
  }
  if (typeof record.type !== 'string' || !FIELD_TYPE_SET.has(record.type)) {
    throw new Error(`schema ${id} ${path}: 非法字段类型 ${String(record.type)}`);
  }
  const field: FieldSchema = {
    key: record.key,
    type: record.type as FieldSchema['type'],
    label: record.label,
  };
  if (isString(record.description)) field.description = record.description;
  if (isBoolean(record.required)) field.required = record.required;
  if (isBoolean(record.editable)) field.editable = record.editable;
  if (record.default !== undefined) field.default = record.default;
  if (isString(record.warning)) field.warning = record.warning;
  if (isString(record.danger)) field.danger = record.danger;
  if (isString(record.source)) field.source = record.source;
  if (record.pathBase !== undefined) {
    if (record.pathBase !== 'mod' && record.pathBase !== 'mission') throw new Error(`schema ${id}: ${path} 路径基准无效`);
    field.pathBase = record.pathBase;
  }
  if (isNumber(record.min)) field.min = record.min;
  if (isNumber(record.max)) field.max = record.max;
  if (isNumber(record.step)) field.step = record.step;
  if (isStringArray(record.options)) field.options = record.options;
  if (isString(record.format)) {
    if (record.format !== 'array-of-entries') {
      throw new Error(`schema ${id} ${path}: 非法 format ${record.format}`);
    }
    field.format = 'array-of-entries';
  }
  if (record.nested !== undefined && record.nested !== null) {
    field.nested = parseFields(id, `${path}.nested`, record.nested);
  }
  if (record.item !== undefined && record.item !== null) {
    field.item = parseField(id, `${path}.item`, record.item);
  }
  if (record.valueSchema !== undefined && record.valueSchema !== null) {
    field.valueSchema = parseField(id, `${path}.valueSchema`, record.valueSchema);
  }
  return field;
}

function parseSources(id: string, raw: unknown): FileSchema['sources'] {
  if (!Array.isArray(raw)) {
    throw new Error(`schema ${id}: sources 必须是数组`);
  }
  return raw.map((source, index) => {
    const record = asRecord(source, `schema ${id} sources[${index}]`);
    if (typeof record.id !== 'string' || typeof record.type !== 'string' || typeof record.path !== 'string') {
      throw new Error(`schema ${id} sources[${index}]: 缺少 id/type/path`);
    }
    if (!SCHEMA_SOURCE_TYPE_SET.has(record.type)) {
      throw new Error(`schema ${id} sources[${index}]: 非法 source 类型 ${record.type}`);
    }
    const extra = record.extraFields === true ? { extraFields: true } : {};
    const keyField = isString(record.keyField) ? { keyField: record.keyField } : {};
    return {
      id: record.id,
      type: record.type as SchemaSourceType,
      path: record.path,
      ...keyField,
      ...extra,
    };
  });
}

function parseCsvColumnSchemas(table: string, raw: unknown): CsvColumnSchema[] {
  const asset = asRecord(raw, `csv column schema ${table}`);
  if (asset.$schema !== CSV_COLUMNS_VERSION) {
    throw new Error(`csv column schema ${table}: $schema 必须是 ${CSV_COLUMNS_VERSION}`);
  }
  if (asset.table !== table) {
    throw new Error(`csv column schema ${table}: table 必须是 ${table}`);
  }
  if (!Array.isArray(asset.columns)) {
    throw new Error(`csv column schema ${table}: columns 必须是数组`);
  }
  return asset.columns.map((column, index) => {
    const record = asRecord(column, `csv column schema ${table}[${index}]`);
    if (typeof record.key !== 'string') {
      throw new Error(`csv column schema ${table}[${index}]: 缺少 key`);
    }
    if (typeof record.control !== 'string' || !CSV_COLUMN_CONTROL_SET.has(record.control)) {
      throw new Error(`csv column schema ${table}[${index}]: 非法控件类型 ${String(record.control)}`);
    }
    const schema: CsvColumnSchema = { key: record.key, control: record.control as CsvColumnSchema['control'] };
    if (isString(record.label)) schema.label = record.label;
    if (isString(record.source)) schema.source = record.source;
    if (isStringArray(record.options)) schema.options = record.options;
    if (isString(record.default)) schema.default = record.default;
    if (isBoolean(record.readonly)) schema.readonly = record.readonly;
    if (isNumber(record.min)) schema.min = record.min;
    if (isNumber(record.max)) schema.max = record.max;
    if (isNumber(record.step)) schema.step = record.step;
    if (isNumber(record.priority)) schema.priority = record.priority;
    return schema;
  });
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${context}: 必须是对象`);
  }
  return value as Record<string, unknown>;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => isString(item));
}
