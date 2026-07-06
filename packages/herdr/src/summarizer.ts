/**
 * Title generation from the session's first user prompt.
 *
 * The title is derived solely from the first user message — it states the
 * session's intent and is stable across the whole session, so it is computed
 * once rather than regenerated on every turn.
 */

import type { Message, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
  branchToMessages,
  createLogger,
  type ExtensionConfigSchema,
  executeSideCall,
  extractMessageText,
  readConfig,
  resolveModel,
  type SideCallResult,
} from "@htwang-contrib/common";

type AnyModel = Model<any>;

const logger = createLogger("herdr");

const CONFIG_NAME = "herdr";

export interface HerdrConfig {
  enabled: boolean;
  model: string;
}

const CONFIG_SCHEMA: ExtensionConfigSchema<HerdrConfig> = {
  defaults: {
    enabled: true,
    model: "",
  },
};

export function loadConfig(): HerdrConfig {
  return readConfig(CONFIG_NAME, CONFIG_SCHEMA);
}

export function resolveSummaryModel(registry: ModelRegistry, config: HerdrConfig): AnyModel | undefined {
  if (!config.model) return undefined;
  return (resolveModel(registry.getAvailable(), config.model) as AnyModel) ?? undefined;
}

const TITLE_SYSTEM_PROMPT =
  "You write a very short title (max 50 characters, no quotes, no trailing punctuation) " +
  "that captures what a coding-agent session is about, based on its first user request. " +
  "Output ONLY the title text — no prefix, no explanation.";

const TITLE_MAX = 60;
const FIRST_PROMPT_MAX = 800;

/**
 * Extract the text of the first user message in the session branch.
 *
 * Walks the branch (oldest → newest) and returns the first non-empty user
 * message, clipped to a sane length. Returns an empty string when the session
 * has no user input yet, so the caller can skip the side-call.
 */
export function firstUserPrompt(branch: SessionEntry[]): string {
  const messages = branchToMessages(branch);
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const text = clip(extractMessageText(msg.content), FIRST_PROMPT_MAX);
    if (text) return text;
  }
  return "";
}

function clip(text: string, max: number): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function parseSessionTitle(rawAnswer: string): string {
  const trimmed = rawAnswer.trim();
  if (!trimmed) return "";
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? "";
  const cleaned = firstLine
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.:;\s]+$/, "")
    .trim();
  if (cleaned.length === 0) return "";
  return cleaned.length > TITLE_MAX ? `${cleaned.slice(0, TITLE_MAX - 1)}…` : cleaned;
}

export interface TitleOutcome {
  title: string;
  fromModel: boolean;
}

/**
 * Summarize the session's first user prompt into a short title via an LLM
 * side-call.
 *
 * `firstPrompt` (captured directly from a `before_agent_start` event) is the
 * preferred input — it is available synchronously, before the prompt is
 * persisted to the session branch. The branch is only used as a fallback to
 * cover resumed sessions where no event fires.
 *
 * Falls back to `fallbackTitle` when the model is unavailable, there is no
 * first prompt yet, or the side-call fails — so callers always get *some*
 * label.
 */
export async function summarizeSessionTitle(opts: {
  firstPrompt?: string;
  branch?: SessionEntry[];
  model: AnyModel | undefined;
  modelRegistry: ModelRegistry;
  fallbackTitle: string;
  signal?: AbortSignal;
}): Promise<TitleOutcome> {
  const { branch, model, modelRegistry, fallbackTitle, signal } = opts;

  const promptText = (opts.firstPrompt ?? "").trim() || (branch ? firstUserPrompt(branch) : "");
  if (!promptText || !model) {
    logger.debug(`summarizeSessionTitle: skipping (promptLen=${promptText.length} hasModel=${!!model})`);
    return { title: fallbackTitle, fromModel: false };
  }
  logger.debug(
    `summarizeSessionTitle: calling side-call model=${model.provider}/${model.id} promptLen=${promptText.length}`,
  );

  const messages: Message[] = [
    {
      role: "user",
      content:
        "A coding-agent session started with this user request:\n\n" +
        promptText +
        "\n\nWrite a short title (max 50 characters) summarizing what this session is about.",
      timestamp: Date.now(),
    },
  ];

  let result: SideCallResult;
  try {
    result = await executeSideCall({
      model,
      modelRegistry,
      systemPrompt: TITLE_SYSTEM_PROMPT,
      messages,
      signal: signal ?? new AbortController().signal,
      commandName: "herdr-title",
    });
  } catch (e) {
    logger.debug(`summarizeSessionTitle: executeSideCall threw ${String(e).slice(0, 300)}`);
    return { title: fallbackTitle, fromModel: false };
  }

  if (!result.ok) {
    const reason = "aborted" in result ? "aborted" : result.error;
    logger.debug(`summarizeSessionTitle: side-call failed: ${String(reason).slice(0, 300)}`);
    return { title: fallbackTitle, fromModel: false };
  }

  const parsed = parseSessionTitle(result.answer);
  if (!parsed) {
    logger.debug(
      `summarizeSessionTitle: could not parse title from answer: ${JSON.stringify(result.answer).slice(0, 200)}`,
    );
    return { title: fallbackTitle, fromModel: false };
  }
  return { title: parsed, fromModel: true };
}
