/**
 * Frontend performance telemetry cross-cutting facility. Log persistence is injected
 * via setPerformanceLogSink by the application log capability at startup; this
 * module depends on no service.
 */

export interface PerformanceFields {
  [key: string]: number | string | boolean | null | undefined;
}

export interface PerformanceLogEntry {
  level: 'debug';
  code: 'perf';
  message: string;
  path: null;
  line: null;
  fields: Record<string, string>;
}

type PerformanceLogSink = (entry: PerformanceLogEntry) => void;

let logSink: PerformanceLogSink = () => {};

export function setPerformanceLogSink(sink: PerformanceLogSink): () => void {
  logSink = sink;
  return () => {
    if (logSink === sink) logSink = () => {};
  };
}

export function measurePerformance<T>(name: string, fields: PerformanceFields, action: () => T): T {
  const startedAt = performance.now();
  try {
    return action();
  } finally {
    recordPerformance(name, performance.now() - startedAt, fields);
  }
}

export async function measurePerformanceAsync<T>(name: string, fields: PerformanceFields, action: () => Promise<T>): Promise<T> {
  const startedAt = performance.now();
  try {
    return await action();
  } finally {
    recordPerformance(name, performance.now() - startedAt, fields);
  }
}

export function recordPerformance(name: string, ms: number, fields: PerformanceFields = {}): void {
  const entryFields: Record<string, string> = { ms: String(Math.round(ms)) };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    entryFields[key] = sanitizePerformanceValue(String(value));
  }
  logSink({
    level: 'debug',
    code: 'perf',
    message: `PERF ${name}`,
    path: null,
    line: null,
    fields: entryFields,
  });
}

function sanitizePerformanceValue(value: string): string {
  return value.replace(/[\r\n\t]/g, ' ').trim();
}
