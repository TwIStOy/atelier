import { isInsideCodeFence, parseJsonObject } from "../shared.ts";
import type { Candidate } from "../types.ts";

export function parseKimi(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  const sectionRe = /<\|tool_calls?_section_begin\|>([\s\S]*?)<\|tool_calls?_section_end\|>/gi;
  for (const section of text.matchAll(sectionRe)) {
    if (section.index === undefined || isInsideCodeFence(text, section.index)) continue;
    const sectionStart = section.index;
    const body = section[1] ?? "";
    const callRe = /<\|tool_call_begin\|>([^<]*?)<\|tool_call_argument_begin\|>([\s\S]*?)<\|tool_call_end\|>/gi;
    for (const call of body.matchAll(callRe)) {
      const name = parseKimiToolName((call[1] ?? "").trim());
      if (!name) continue;
      const args = parseJsonObject((call[2] ?? "").trim()) ?? {};
      candidates.push({
        name,
        arguments: args,
        grammar: "kimi",
        range: { start: sectionStart, end: sectionStart + section[0].length },
      });
    }
  }
  return candidates;
}

function parseKimiToolName(idText: string): string | undefined {
  const canonical = /^functions\.([A-Za-z_][\w.-]*):\d+$/.exec(idText);
  if (canonical) return canonical[1];
  const relaxed = /^(?:functions\.)?([A-Za-z_][\w.-]*)(?::\d+)?$/.exec(idText);
  if (relaxed && !/^call[_-]?\d+$/i.test(relaxed[1] ?? "")) return relaxed[1];
  return undefined;
}
