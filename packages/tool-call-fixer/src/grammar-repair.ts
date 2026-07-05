import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";

export type GrammarRepairMode = "recover" | "strip";

export interface RecoveredToolCall {
  name: string;
  arguments: Record<string, unknown>;
  grammar: string;
}

interface Range {
  start: number;
  end: number;
}

interface Candidate extends RecoveredToolCall {
  range: Range;
  stripOnly?: boolean;
}

export interface GrammarRepairConfig {
  enabled: boolean;
  mode: GrammarRepairMode;
  requireKnownTool: boolean;
}

export interface GrammarRepairResult {
  changed: boolean;
  recoveredCalls: RecoveredToolCall[];
  strippedRanges: number;
  message: AssistantMessage;
}

type AssistantContent = AssistantMessage["content"][number];

function parseJsonValue(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

function parseJsonValueOrString(value: string): unknown {
  const parsed = parseJsonValue(value);
  return parsed === undefined ? value : parsed;
}

function maybeParseJsonValue(value: string): unknown {
  if (value === "") return "";
  if (/^(?:true|false|null|-?\d|[[{]|")/.test(value)) {
    return parseJsonValueOrString(value);
  }
  return value;
}

// --- GLM grammar parser -----------------------------------------------------

function isInsideCodeFence(text: string, index: number): boolean {
  const before = text.slice(0, index);
  const fences = before.match(/```/g);
  return Boolean(fences && fences.length % 2 === 1);
}

const TOOL_CALL_WRAPPER_RE = /<(tool_call|tools)>[\s\S]*?<\/\1>/giu;

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

const GRAMMAR_PARSERS: ReadonlyArray<(text: string) => Candidate[]> = [parseGlm];

function parseToolGrammarCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const parser of GRAMMAR_PARSERS) {
    candidates.push(...parser(text));
  }
  return candidates.filter((candidate) => candidate.range.end > candidate.range.start);
}

function rangesOverlap(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}

function selectCandidates(candidates: Candidate[]): Candidate[] {
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

function isAllowedTool(name: string, config: GrammarRepairConfig, knownTools: Set<string>): boolean {
  if (!config.requireKnownTool) return true;
  return knownTools.size > 0 && knownTools.has(name);
}

function removeRanges(text: string, ranges: Range[]): string {
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

function getPartText(part: AssistantContent): string | undefined {
  if (part.type === "text" && typeof part.text === "string") return part.text;
  if (part.type === "thinking" && typeof part.thinking === "string") return part.thinking;
  return undefined;
}

function setPartText(part: AssistantContent, text: string): AssistantContent {
  if (part.type === "text") return { ...part, text };
  if (part.type === "thinking") return { ...part, thinking: text };
  return part;
}

function isToolCallContent(part: AssistantContent): part is ToolCall {
  return part.type === "toolCall" && typeof part.name === "string";
}

function makeRecoveredToolCallId(grammar: string, index: number): string {
  return `tool_repair_${grammar.replace(/[^a-z0-9]/gi, "_")}_${Date.now().toString(36)}_${index}`;
}

export function repairAssistantMessageGrammarLeaks(
  message: AssistantMessage,
  config: GrammarRepairConfig,
  knownTools: Set<string> = new Set(),
): GrammarRepairResult {
  if (!config.enabled || message.role !== "assistant" || !Array.isArray(message.content)) {
    return { changed: false, recoveredCalls: [], strippedRanges: 0, message };
  }

  const existingToolCalls = message.content.filter(isToolCallContent);
  const recoveredCalls: RecoveredToolCall[] = [];
  let strippedRanges = 0;
  let changed = false;

  const nextContent = message.content.map((part) => {
    const text = getPartText(part);
    if (text === undefined) return part;

    const candidates = selectCandidates(parseToolGrammarCandidates(text)).filter(
      (candidate) => candidate.stripOnly || isAllowedTool(candidate.name, config, knownTools),
    );
    if (candidates.length === 0) return part;

    strippedRanges += candidates.length;
    changed = true;
    for (const candidate of candidates) {
      if (candidate.stripOnly) continue;
      if (Object.keys(candidate.arguments).length === 0) continue;
      recoveredCalls.push({
        name: candidate.name,
        arguments: candidate.arguments,
        grammar: candidate.grammar,
      });
    }

    const strippedText = removeRanges(
      text,
      candidates.map((candidate) => candidate.range),
    );
    return setPartText(part, strippedText);
  });

  const shouldRecover = config.mode === "recover" && existingToolCalls.length === 0 && recoveredCalls.length > 0;
  if (!changed && !shouldRecover) {
    return { changed: false, recoveredCalls: [], strippedRanges: 0, message };
  }

  if (shouldRecover) {
    let index = 0;
    for (const call of recoveredCalls) {
      const block: ToolCall = {
        type: "toolCall",
        id: makeRecoveredToolCallId(call.grammar, index++),
        name: call.name,
        arguments: call.arguments,
      };
      nextContent.push(block);
    }
  }

  const nextMessage: AssistantMessage = { ...message, content: nextContent };
  if (shouldRecover) {
    nextMessage.stopReason = "toolUse";
  }

  return {
    changed: changed || shouldRecover,
    recoveredCalls: shouldRecover ? recoveredCalls : [],
    strippedRanges,
    message: nextMessage,
  };
}
