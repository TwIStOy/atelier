import { isInsideCodeFence, maybeParseJsonValue, TOOL_CALL_WRAPPER_RE } from "../shared.ts";
import type { Candidate } from "../types.ts";

export function parseGlm(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const match of text.matchAll(TOOL_CALL_WRAPPER_RE)) {
    if (match.index === undefined || isInsideCodeFence(text, match.index)) continue;
    const tag = (match[1] ?? "").toLowerCase();
    const openTagEnd = match[0].indexOf(">") + 1;
    const closeTag = `</${tag}>`;
    const body = match[0].slice(openTagEnd, match[0].length - closeTag.length);
    const call = parseGlmToolCallBody(body);
    if (call) {
      candidates.push({ ...call, range: { start: match.index, end: match.index + match[0].length } });
    }
  }
  return candidates;
}

function parseGlmToolCallBody(body: string): Omit<Candidate, "range" | "stripOnly"> | undefined {
  const keyRe = /<arg_key>([\s\S]*?)<\/arg_key>/gi;
  const valueRe = /<arg_value>([\s\S]*?)<\/arg_value>/gi;
  const keys = [...body.matchAll(keyRe)].map((m) => (m[1] ?? "").trim()).filter(Boolean);
  const values = [...body.matchAll(valueRe)].map((m) => (m[1] ?? "").trim());
  const nameEnd = keys.length === 0 ? body.length : body.search(/<arg_key>/i);
  const name = body.slice(0, nameEnd).trim().split(/\s+/)[0];
  if (!name || !/^[A-Za-z_][\w.-]*$/.test(name)) return undefined;
  const args: Record<string, unknown> = {};
  keys.forEach((key, i) => {
    args[key] = maybeParseJsonValue(values[i] ?? "");
  });
  return { name, arguments: args, grammar: "glm" };
}
