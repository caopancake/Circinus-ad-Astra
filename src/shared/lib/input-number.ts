export function parseInputNumber(raw: string, integer: boolean): number | string {
  const text = raw.trim();
  if (text === '') return raw;
  if (integer && !/^[+-]?\d+$/.test(text)) return raw;
  if (!integer && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return raw;
  const parsed = Number(text);
  return (integer ? Number.isSafeInteger(parsed) : Number.isFinite(parsed)) ? parsed : raw;
}
