import type { AssistantMessage, ToolCall } from "@earendil-works/pi-ai";
import { GRAMMAR_PARSERS } from "./parsers/index.ts";
import {
  getPartText,
  isAllowedTool,
  isToolCallContent,
  makeRecoveredToolCallId,
  removeRanges,
  selectCandidates,
  setPartText,
} from "./shared.ts";
import type { Candidate, GrammarRepairConfig, GrammarRepairResult, RecoveredToolCall } from "./types.ts";

function parseToolGrammarCandidates(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const parser of GRAMMAR_PARSERS) {
    candidates.push(...parser(text));
  }
  return candidates.filter((candidate) => candidate.range.end > candidate.range.start);
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
