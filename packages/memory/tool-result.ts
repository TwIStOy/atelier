export function jsonResult(
  data: unknown,
  details: Record<string, unknown> = {},
) {
  const text = typeof data === "string" ? data : JSON.stringify(data ?? null);
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

export function jsonError(e: unknown) {
  return jsonResult({ error: String(e) });
}
