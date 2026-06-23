import {
  executeSideCall,
  readConfig,
  resolveModel,
  assistantMessageText,
  type ExtensionConfigSchema,
  type SideCallResult,
} from "@htwang-contrib/common";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Message, Model } from "@earendil-works/pi-ai";

type AnyModel = Model<any>;

export interface SummaryConfig {
  model: string;
  enabled: boolean;
}

const CONFIG_NAME = "moshi-hooks-extra";

const CONFIG_SCHEMA: ExtensionConfigSchema<SummaryConfig> = {
  defaults: {
    model: "",
    enabled: true,
  },
};

export function loadSummaryConfig(): SummaryConfig {
  return readConfig(CONFIG_NAME, CONFIG_SCHEMA);
}

export function resolveSummaryModel(
  registry: ModelRegistry,
  config: SummaryConfig,
): AnyModel | undefined {
  if (!config.model) return undefined;
  return (
    (resolveModel(registry.getAvailable(), config.model) as AnyModel) ??
    undefined
  );
}

const SUMMARY_SYSTEM_PROMPT =
  "You summarize what a coding agent just accomplished so it can be shown as a push notification. " +
  "Reply with two short lines: a title (max 8 words) and a one-sentence summary (max 200 chars). " +
  "Separate title and summary with a newline. Do not add any other text, prefixes, or quotes.";

export const SUMMARY_TITLE_FALLBACK = "Task complete";

export function buildSummaryPrompt(
  userPrompt: string,
  lastAssistant: AssistantMessage,
): Message[] {
  const assistantText = assistantMessageText(lastAssistant).trim();
  const promptParts: string[] = [];
  promptParts.push("User asked the coding agent to do the following:");
  promptParts.push(userPrompt || "(no prompt recorded)");
  promptParts.push("");
  promptParts.push("The agent's final reply was:");
  promptParts.push(assistantText || "(empty reply)");
  promptParts.push("");
  promptParts.push(
    "Summarize what the agent accomplished in the format above.",
  );
  return [
    {
      role: "user",
      content: promptParts.join("\n"),
      timestamp: Date.now(),
    },
  ];
}

export interface ParsedSummary {
  title: string;
  message: string;
}

export function parseSummary(rawAnswer: string): ParsedSummary | null {
  const trimmed = rawAnswer.trim();
  if (!trimmed) return null;
  const lines = trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const title = clipTitle(lines[0]);
  const message = lines.length > 1 ? clipMessage(lines.slice(1).join(" ")) : "";
  if (!title && !message) return null;
  return { title, message };
}

const TITLE_MAX = 80;
const MESSAGE_MAX = 200;

function clipTitle(text: string): string {
  return clipText(text, TITLE_MAX);
}

function clipMessage(text: string): string {
  return clipText(text, MESSAGE_MAX);
}

function clipText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1) + "…";
}

export interface SummaryOutcome {
  title: string;
  message: string;
  fromModel: boolean;
}

export async function summarizeAgentTurn(opts: {
  userPrompt: string;
  lastAssistant: AssistantMessage;
  model: AnyModel | undefined;
  modelRegistry: ModelRegistry;
  fallbackTitle: string;
  fallbackMessage: string;
  signal?: AbortSignal;
}): Promise<SummaryOutcome> {
  const {
    userPrompt,
    lastAssistant,
    model,
    modelRegistry,
    fallbackTitle,
    fallbackMessage,
    signal,
  } = opts;

  if (!model) {
    return {
      title: fallbackTitle,
      message: fallbackMessage,
      fromModel: false,
    };
  }

  const messages = buildSummaryPrompt(userPrompt, lastAssistant);
  const result: SideCallResult = await executeSideCall({
    model,
    modelRegistry,
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    messages,
    signal: signal ?? new AbortController().signal,
    commandName: "moshi-summary",
  });

  if (!result.ok) {
    return {
      title: fallbackTitle,
      message: fallbackMessage,
      fromModel: false,
    };
  }

  const parsed = parseSummary(result.answer);
  if (!parsed || (!parsed.title && !parsed.message)) {
    return {
      title: fallbackTitle,
      message: fallbackMessage,
      fromModel: false,
    };
  }

  return {
    title: parsed.title || SUMMARY_TITLE_FALLBACK,
    message: parsed.message || fallbackMessage,
    fromModel: true,
  };
}

export function lastAssistantMessage(
  messages: unknown[] | undefined,
): AssistantMessage | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (
      msg &&
      typeof msg === "object" &&
      (msg as { role?: unknown }).role === "assistant"
    ) {
      return msg as AssistantMessage;
    }
  }
  return undefined;
}
