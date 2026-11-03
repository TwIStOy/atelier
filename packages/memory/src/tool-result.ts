export function jsonResult(data: unknown, details: Record<string, unknown> = {}) {
  const text = typeof data === "string" ? data : JSON.stringify(data ?? null);
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

export function jsonError(e: unknown) {
  return jsonResult({ error: String(e) });
}

export function textContent(result: unknown): string {
  const content = (result as { content?: unknown } | null | undefined)?.content;
  return typeof content === "string" ? content : "";
}

export function contentLines(content: string): number {
  return content ? content.split("\n").length : 0;
}
