import type { AssistantMessage, JsonObject } from "@earendil-works/pi-ai";

export type GrammarRepairMode = "recover" | "strip";

export interface RecoveredToolCall {
  name: string;
  arguments: JsonObject;
  grammar: string;
}

export interface Range {
  start: number;
  end: number;
}

export interface Candidate extends RecoveredToolCall {
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

export type AssistantContent = AssistantMessage["content"][number];

export type GrammarParser = (text: string) => Candidate[];
