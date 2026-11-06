import type { Message, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { createLogger } from "@htwang-contrib/common/log";
import { executeSideCall, type SideCallResult } from "@htwang-contrib/common/side-call";

type AnyModel = Model<any>;

const logger = createLogger("compact-thinking");

const SUMMARY_INPUT_MAX_CHARS = 60_000;
const SUMMARY_OUTPUT_MAX_CHARS = 240;

const SYSTEM_PROMPT =
  "You summarize the chain-of-thought of an AI coding agent into a single short plain-text description " +
  "(max 25 words) of what the agent analyzed and decided, so the user can grasp it at a glance. " +
  "Output ONLY the summary text — no prefix, no quotes, no markdown, no trailing period.";

export function clipThinkingInput(text: string, maxChars = SUMMARY_INPUT_MAX_CHARS): string {
  if (text.length <= maxChars) return text;
  const headChars = Math.floor(maxChars * 0.7);
  const tailChars = maxChars - headChars;
  return `${text.slice(0, headChars)}\n\n[... ${text.length - maxChars} characters omitted ...]\n\n${text.slice(text.length - tailChars)}`;
}

export function parseThinkingSummary(rawAnswer: string): string {
  const firstLine = rawAnswer.trim().split(/\r?\n/, 1)[0] ?? "";
  const cleaned = firstLine.replace(/^["'`]+|["'`.]+$/g, "").trim();
  if (!cleaned) return "";
  return cleaned.length > SUMMARY_OUTPUT_MAX_CHARS ? `${cleaned.slice(0, SUMMARY_OUTPUT_MAX_CHARS - 1)}…` : cleaned;
}

export async function summarizeThinking(opts: {
  thinkingText: string;
  model: AnyModel;
  modelRegistry: ModelRegistry;
  signal: AbortSignal;
}): Promise<string | undefined> {
  const { thinkingText, model, modelRegistry, signal } = opts;
  if (!thinkingText.trim()) return undefined;

  const messages: Message[] = [
    {
      role: "user",
      content: `Summarize this agent thinking:\n\n${clipThinkingInput(thinkingText)}`,
      timestamp: Date.now(),
    },
  ];

  let result: SideCallResult;
  try {
    result = await executeSideCall({
      model,
      modelRegistry,
      systemPrompt: SYSTEM_PROMPT,
      messages,
      signal,
      commandName: "compact-thinking-summary",
    });
  } catch (err) {
    logger.debug(`summarizeThinking: side-call threw ${String(err).slice(0, 300)}`);
    return undefined;
  }

  if (!result.ok) {
    const reason = "aborted" in result ? "aborted" : result.error;
    logger.debug(`summarizeThinking: side-call failed: ${String(reason).slice(0, 300)}`);
    return undefined;
  }

  const summary = parseThinkingSummary(result.answer);
  if (!summary) {
    logger.debug(`summarizeThinking: empty summary from answer ${JSON.stringify(result.answer).slice(0, 200)}`);
    return undefined;
  }
  return summary;
}
