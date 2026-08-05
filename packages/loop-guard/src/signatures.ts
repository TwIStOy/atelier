import { createHash } from "node:crypto";

export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "bigint") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function toolSignature(toolName: string, input: unknown): string {
  return `${toolName}:${hashText(stableStringify(input))}`;
}

export function resultSignature(resultText: string, isError: boolean): string {
  return hashText(`${isError ? "error" : "ok"}:${resultText}`);
}

export function summarizeCall(toolName: string, input: unknown): string {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    for (const key of ["path", "command", "pattern", "query", "url", "file"]) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) {
        return truncate(`${toolName}(${value})`);
      }
    }
  }
  return truncate(`${toolName}(${stableStringify(input)})`);
}

function truncate(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
