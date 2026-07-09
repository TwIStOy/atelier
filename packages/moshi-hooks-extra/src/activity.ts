import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  type AskUserPromptPayload,
  type AskUserPromptQuestion,
  assistantMessageText,
} from "@htwang-contrib/common";

const MAX_PROMPT_CHARS = 200;
const MAX_TITLE_CHARS = 80;

export function clipText(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function formatUserPrompt(prompt: string): string {
  return clipText(prompt, MAX_PROMPT_CHARS);
}

export function assistantTitleFromMessage(message: unknown): string {
  if (!message || typeof message !== "object") return "";
  const msg = message as { role?: unknown; content?: unknown };
  if (msg.role !== "assistant") return "";
  try {
    return clipText(
      assistantMessageText(msg as AssistantMessage),
      MAX_TITLE_CHARS,
    );
  } catch {
    return "";
  }
}

export function lastAssistantTitleFromMessages(
  messages: unknown[] | undefined,
): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const title = assistantTitleFromMessage(messages[i]);
    if (title) return title;
  }
  return "";
}

export interface SessionActivity {
  lastUserPrompt: string;
}

export class ActivityTracker {
  private bySession = new Map<string, SessionActivity>();

  private ensure(sessionKey: string): SessionActivity {
    let entry = this.bySession.get(sessionKey);
    if (!entry) {
      entry = { lastUserPrompt: "" };
      this.bySession.set(sessionKey, entry);
    }
    return entry;
  }

  rememberUserPrompt(sessionKey: string, prompt: string): string {
    const formatted = formatUserPrompt(prompt);
    if (!formatted) return "";
    this.ensure(sessionKey).lastUserPrompt = formatted;
    return formatted;
  }

  userPrompt(sessionKey: string): string {
    return this.bySession.get(sessionKey)?.lastUserPrompt ?? "";
  }

  reset(): void {
    this.bySession.clear();
  }
}

export function sessionKeyFor(
  sessionID: string | undefined,
  cwd: string,
): string {
  return sessionID && sessionID.length > 0 ? sessionID : `cwd:${cwd}`;
}

export interface AskUserQuestionSummary {
  title: string;
  message: string;
  optionCount: number;
}

export function summarizeAskUserQuestion(
  payload: AskUserPromptPayload | null | undefined,
): AskUserQuestionSummary {
  const first = payload?.questions?.[0];
  if (!first) {
    return {
      title: "Pi needs input",
      message: "Input requested",
      optionCount: 0,
    };
  }
  const message =
    first.question?.trim() || first.header?.trim() || "Input requested";
  return {
    title: "Pi needs input",
    message: clipText(message, MAX_PROMPT_CHARS),
    optionCount: countOptions(payload),
  };
}

function countOptions(
  payload: AskUserPromptPayload | null | undefined,
): number {
  if (!payload?.questions) return 0;
  return payload.questions.reduce(
    (sum, q: AskUserPromptQuestion) => sum + (q.options?.length ?? 0),
    0,
  );
}
