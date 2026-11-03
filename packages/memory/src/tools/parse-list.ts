/**
 * Normalize `hat` list output: bare array, `{<key>: [...]}` for any of the
 * given keys, or `{data: [...]}`.
 */
export function parseListResult(result: unknown, ...keys: string[]): Record<string, unknown>[] {
  if (!result || typeof result !== "object") return [];
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const r = result as Record<string, unknown>;
  for (const key of keys) {
    if (Array.isArray(r[key])) return r[key] as Record<string, unknown>[];
  }
  if (Array.isArray(r.data)) return r.data as Record<string, unknown>[];
  return [];
}
