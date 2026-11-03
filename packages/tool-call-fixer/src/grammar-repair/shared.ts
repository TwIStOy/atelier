import type { JsonObject, JsonValue, ToolCall } from "@earendil-works/pi-ai";
import type { AssistantContent, Candidate, GrammarRepairConfig, Range } from "./types.ts";

export const TOOL_CALL_WRAPPER_RE = /<(tool_call|tools)>[\s\S]*?<\/\1>/giu;

function isObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseJsonValue(json: string): JsonValue | undefined {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function parseJsonValueOrString(value: string): JsonValue {
  const parsed = parseJsonValue(value);
  return parsed === undefined ? value : parsed;
}

export function maybeParseJsonValue(value: string): JsonValue {
  if (value === "") return "";
  if (/^(?:true|false|null|-?\d|[[{]|")/.test(value)) {
    return parseJsonValueOrString(value);
  }
  return value;
}

export function parseJsonObject(json: string): JsonObject | undefined {
  const parsed = parseJsonValue(json);
  return isObject(parsed) ? parsed : undefined;
}

function normalizeArgumentsObject(value: JsonValue | undefined): JsonObject | undefined {
  if (typeof value === "string") {
    return normalizeArgumentsObject(parseJsonValue(value));
  }
  if (isObject(value)) {
    const nested = value.arguments;
    if (typeof nested === "string" || isObject(nested)) {
      const unwrapped = normalizeArgumentsObject(nested);
      if (unwrapped) return unwrapped;
    }
    return value;
  }
  return undefined;
}

function nestedFunctionName(value: JsonObject): unknown {
  return isObject(value.function) ? value.function.name : undefined;
}

function toolCallNameFrom(value: JsonObject): unknown {
  return value.name ?? value.function_name ?? nestedFunctionName(value);
}

function callFromJsonObject(value: JsonObject): { name: string; arguments: JsonObject } | undefined {
  const name = toolCallNameFrom(value);
  if (typeof name !== "string" || !name.trim()) return undefined;
  let args: JsonValue | undefined = value.arguments ?? value.args ?? value.parameters;
  if (args === undefined && isObject(value.function)) args = value.function.arguments;
  return { name: name.trim(), arguments: normalizeArgumentsObject(args) ?? {} };
}

export function callsFromJsonValue(value: JsonValue | undefined): Array<{ name: string; arguments: JsonObject }> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => (isObject(item) ? callsFromJsonValue(item) : []));
  }
  if (!isObject(value)) return [];
  const call = callFromJsonObject(value);
  return call ? [call] : [];
}

export function extractFirstBalancedJson(text: string): { json: string; start: number; end: number } | undefined {
  const start = text.search(/[[{]/);
  if (start === -1) return undefined;
  const opener = text[start];
  const closer = opener === "{" ? "}" : "]";
  const end = findMatching(text, start, opener, closer);
  if (end === undefined) return undefined;
  return { json: text.slice(start, end + 1), start, end: end + 1 };
}

interface QuoteScan {
  quote: string | undefined;
  escaped: boolean;
}

function advanceQuoteScan(scan: QuoteScan, ch: string): void {
  if (scan.escaped) {
    scan.escaped = false;
  } else if (ch === "\\") {
    scan.escaped = true;
  } else if (ch === scan.quote) {
    scan.quote = undefined;
  }
}

function findMatching(text: string, openIndex: number, opener: string, closer: string): number | undefined {
  let depth = 0;
  const scan: QuoteScan = { quote: undefined, escaped: false };
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (scan.quote) {
      advanceQuoteScan(scan, ch);
      continue;
    }
    if (ch === '"' || ch === "'") {
      scan.quote = ch;
      continue;
    }
    if (ch === opener) depth++;
    if (ch === closer) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return undefined;
}

export function unwrapMarkdownFence(text: string): string {
  const match = /^```\w*\s*([\s\S]*?)\s*```$/.exec(text);
  return match ? (match[1] ?? "") : text;
}

export function isInsideCodeFence(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const fences = before.match(/```/g);
  return Boolean(fences && fences.length % 2 === 1);
}

export function removeRanges(text: string, ranges: Range[]): string {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let result = "";
  let cursor = 0;
  for (const range of sorted) {
    result += text.slice(cursor, range.start);
    cursor = Math.max(cursor, range.end);
  }
  result += text.slice(cursor);
  return result
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function rangesOverlap(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}

export function selectCandidates(candidates: Candidate[]): Candidate[] {
  const sorted = [...candidates].sort((a, b) => {
    if (a.range.start !== b.range.start) return a.range.start - b.range.start;
    return b.range.end - b.range.start - (a.range.end - a.range.start);
  });
  const selected: Candidate[] = [];
  for (const candidate of sorted) {
    const duplicate = selected.some((existing) => {
      const sameRange = existing.range.start === candidate.range.start && existing.range.end === candidate.range.end;
      return !sameRange && rangesOverlap(existing.range, candidate.range);
    });
    if (!duplicate) selected.push(candidate);
  }
  return selected;
}

export function isAllowedTool(name: string, config: GrammarRepairConfig, knownTools: Set<string>): boolean {
  if (!config.requireKnownTool) return true;
  return knownTools.size > 0 && knownTools.has(name);
}

export function getPartText(part: AssistantContent): string | undefined {
  if (part.type === "text" && typeof part.text === "string") return part.text;
  if (part.type === "thinking" && typeof part.thinking === "string") return part.thinking;
  return undefined;
}

export function setPartText(part: AssistantContent, text: string): AssistantContent {
  if (part.type === "text") return { ...part, text };
  if (part.type === "thinking") return { ...part, thinking: text };
  return part;
}

export function isToolCallContent(part: AssistantContent): part is ToolCall {
  return part.type === "toolCall" && typeof part.name === "string";
}

export function makeRecoveredToolCallId(grammar: string, index: number): string {
  return `tool_repair_${grammar.replace(/[^a-z0-9]/gi, "_")}_${Date.now().toString(36)}_${index}`;
}
