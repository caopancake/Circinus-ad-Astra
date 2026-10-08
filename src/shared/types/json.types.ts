export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type RowData = Record<string, JsonValue>;

export type JsonInputShape = 'object' | 'array' | 'json';
export type JsonInputValue<T extends JsonInputShape> = T extends 'object' ? RowData : T extends 'array' ? JsonValue[] : JsonValue;
