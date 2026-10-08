export const FIELD_TYPES = [
  'string',
  'text',
  'integer',
  'float',
  'boolean',
  'enum',
  'color-rgb',
  'color-rgba',
  'path-image',
  'path',
  'string-array',
  'tag-select',
  'object',
  'array',
  'array-of-object',
  'key-value',
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export type SchemaFieldUpdate = { kind: 'set'; value: unknown } | { kind: 'remove' };

export const FIELD_TYPE_SET: ReadonlySet<string> = new Set(FIELD_TYPES);

export interface FieldSchema {
  key: string;
  type: FieldType;
  label: string;
  description?: string;
  required?: boolean;
  editable?: boolean;
  default?: unknown;
  warning?: string;
  danger?: string;
  source?: string;
  pathBase?: 'mod' | 'mission';
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  nested?: FieldSchema[];
  item?: FieldSchema;
  valueSchema?: FieldSchema;
  /** Underlying key-value storage format: 'array-of-entries' means [{k:v}, ...] arrays */
  format?: 'array-of-entries';
}

export interface SectionSchema {
  id: string;
  label: string;
  collapsed?: boolean;
  fields: FieldSchema[];
}

export const SCHEMA_SOURCE_TYPES = ['csv-row', 'json-file', 'text-file'] as const;

export type SchemaSourceType = (typeof SCHEMA_SOURCE_TYPES)[number];

export const SCHEMA_SOURCE_TYPE_SET: ReadonlySet<string> = new Set(SCHEMA_SOURCE_TYPES);

export interface SchemaSource {
  id: string;
  type: SchemaSourceType;
  path: string;
  keyField?: string;
  extraFields?: boolean;
}

export interface FileSchema {
  $schema?: string;
  id: string;
  fileType?: string;
  displayName?: string;
  description?: string;
  targetFile?: string;
  gameVersion?: string;
  sources?: SchemaSource[];
  sections?: SectionSchema[];
}

export const CSV_COLUMN_CONTROLS = ['text', 'number', 'boolean', 'enum', 'reference', 'tags', 'multi', 'path-image', 'color'] as const;

export type CsvColumnControl = (typeof CSV_COLUMN_CONTROLS)[number];

export const CSV_COLUMN_CONTROL_SET: ReadonlySet<string> = new Set(CSV_COLUMN_CONTROLS);

export interface CsvColumnSchema {
  key: string;
  label?: string;
  control: CsvColumnControl;
  source?: string;
  options?: string[];
  default?: string;
  readonly?: boolean;
  min?: number;
  max?: number;
  step?: number;
  priority?: number;
}

export type { DiscoveredField } from '@/shared/types';
