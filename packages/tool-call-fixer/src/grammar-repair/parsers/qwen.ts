import {
  callsFromJsonValue,
  extractFirstBalancedJson,
  isInsideCodeFence,
  parseJsonValue,
  TOOL_CALL_WRAPPER_RE,
  unwrapMarkdownFence,
} from "../shared.ts";
import type { Candidate } from "../types.ts";

export function parseQwen(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const match of text.matchAll(TOOL_CALL_WRAPPER_RE)) {
    if (match.index === undefined || isInsideCodeFence(text, match.index)) continue;
    const range = { start: match.index, end: match.index + match[0].length };
    const tag = (match[1] ?? "").toLowerCase();
    const openTagEnd = match[0].indexOf(">") + 1;
    const closeTag = `</${tag}>`;
    const body = match[0].slice(openTagEnd, match[0].length - closeTag.length);
    for (const call of parseToolCallJsonBody(body, "qwen")) {
      candidates.push({ ...call, range });
    }
  }
  return candidates;
}

function parseToolCallJsonBody(body: string, grammar: string): Array<Omit<Candidate, "range" | "stripOnly">> {
  const trimmed = unwrapMarkdownFence(body.trim());
  const json = extractFirstBalancedJson(trimmed)?.json ?? trimmed;
  return callsFromJsonValue(parseJsonValue(json)).map((call) => ({
    name: call.name,
    arguments: call.arguments,
    grammar,
  }));
}
