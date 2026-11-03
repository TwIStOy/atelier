/**
 * Normalize `hat` list output: bare array, `{<key>: [...]}` for any of the
 * given keys, or `{data: [...]}`.
 */
export function parseListResult(result: unknown, ...keys: string[]): Record<string, unknown>[] {
  if (!result || typeof result !== "object") return [];
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  return listFromRecord(result as Record<string, unknown>, keys);
}

function listFromRecord(record: Record<string, unknown>, keys: string[]): Record<string, unknown>[] {
  const keyed = keyedArray(record, keys);
  return keyed ?? arrayField(record, "data") ?? [];
}

function keyedArray(record: Record<string, unknown>, keys: string[]): Record<string, unknown>[] | undefined {
  for (const key of keys) {
    const list = arrayField(record, key);
    if (list !== undefined) return list;
  }
  return undefined;
}

function arrayField(record: Record<string, unknown>, key: string): Record<string, unknown>[] | undefined {
  const value = record[key];
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : undefined;
}
