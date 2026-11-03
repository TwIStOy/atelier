import type { ValidationIssue } from "../schemas.ts";

export interface RepairContext {
  toolName: string;
  parent: Record<string, unknown>;
  key: string;
  value: unknown;
  issue: ValidationIssue;
}

export interface ShapeRepairResult {
  ruleName: string;
  note: string;
}

export type RepairRule = (ctx: RepairContext) => ShapeRepairResult | null;

export function tryParseJsonArray(str: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export const dropNullOrUndefined: RepairRule = (ctx) => {
  if (!(ctx.key in ctx.parent)) return null;
  if (ctx.value != null) return null;
  delete ctx.parent[ctx.key];
  return {
    ruleName: "dropNullOrUndefined",
    note: `dropped ${ctx.value === null ? "null" : "undefined"} \`${ctx.key}\``,
  };
};

export const dropEmptyObjectPlaceholder: RepairRule = (ctx) => {
  if (!(ctx.key in ctx.parent)) return null;
  if (typeof ctx.value !== "object" || ctx.value === null || Array.isArray(ctx.value)) return null;
  if (Object.keys(ctx.value as Record<string, unknown>).length !== 0) return null;
  delete ctx.parent[ctx.key];
  return { ruleName: "dropEmptyObjectPlaceholder", note: `dropped empty \`{}\` placeholder \`${ctx.key}\`` };
};

export const parseJsonStringifiedArray: RepairRule = (ctx) => {
  if (typeof ctx.value !== "string") return null;
  const parsed = tryParseJsonArray(ctx.value);
  if (parsed === null) return null;
  ctx.parent[ctx.key] = parsed;
  return { ruleName: "parseJsonStringifiedArray", note: `parsed JSON-stringified array \`${ctx.key}\`` };
};

export const wrapBareStringAsArray: RepairRule = (ctx) => {
  if (ctx.issue.code !== "invalid_type") return null;
  if (ctx.issue.expected !== "array") return null;
  if (typeof ctx.value !== "string") return null;
  ctx.parent[ctx.key] = [ctx.value];
  return { ruleName: "wrapBareStringAsArray", note: `wrapped bare string \`${ctx.key}\` as single-element array` };
};

export const REPAIR_RULES: readonly RepairRule[] = [
  dropNullOrUndefined,
  dropEmptyObjectPlaceholder,
  parseJsonStringifiedArray,
  wrapBareStringAsArray,
];

const STRING_ARG_TOOLS: Readonly<Record<string, string>> = {
  read: "path",
  bash: "command",
  grep: "pattern",
  glob: "pattern",
  ls: "path",
};

export function wrapRootStringAsObject(
  input: unknown,
  toolName: string,
): { value: Record<string, unknown>; note: string } | null {
  if (typeof input !== "string") return null;
  const field = STRING_ARG_TOOLS[toolName];
  if (!field) return null;
  return { value: { [field]: input }, note: `wrapped bare string as \`${toolName}.${field}\`` };
}
