/**
 * Shared session-title generation.
 *
 * Summarizes the session's first user prompt into a short title via an LLM
 * side-call. The title is derived solely from the first user message — it
 * states the session's intent and is stable across the whole session, so it
 * is computed once rather than regenerated on every turn.
 *
 * The title is process-shared: a singleton holds the latched title for the
 * current session, so multiple consumers (herdr tab titles, htw-producer
 * reports) reuse ONE side-call instead of each generating their own.
 */

import type { Message, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ModelRegistry, SessionEntry } from "@earendil-works/pi-coding-agent";
import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "./config/index.ts";
import { getGlobalState } from "./global-state.ts";
import { createLogger } from "./log.ts";
import { extractMessageText } from "./message-text.ts";
import { resolveModel } from "./model-resolve.ts";
import { branchToMessages } from "./session-cache.ts";
import { executeSideCall, type SideCallResult } from "./side-call.ts";

type AnyModel = Model<any>;

const logger = createLogger("session-title");

export const SESSION_TITLE_CONFIG_ID = "session-title";

export interface SessionTitleConfig {
  enabled: boolean;
  model: string;
}

const CONFIG_SCHEMA: ExtensionConfigSchema<SessionTitleConfig> = {
  defaults: {
    enabled: true,
    model: "",
  },
};

export function loadSessionTitleConfig(): SessionTitleConfig {
  return readConfig(SESSION_TITLE_CONFIG_ID, CONFIG_SCHEMA);
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
      commandName: "session-title",
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

// --- the session-scoped service -------------------------------------------
//
// One latched title per session, shared by every consumer extension in the
// process. Consumers drive the lifecycle: reset on session_start, capture the
// first prompt on before_agent_start, ensure on natural retry points. The
// latch + in-flight dedup make double calls from multiple consumers harmless.

interface SessionTitleState {
  title: string;
  generated: boolean;
  firstPrompt: string;
  listeners: Set<(title: string) => void>;
  modelOptions: Array<{ label: string; value: string }>;
  initDone: boolean;
  inFlight: Promise<void> | undefined;
  abort: AbortController;
}

function titleState(): SessionTitleState {
  return getGlobalState("htwang-contrib-session-title", () => ({
    title: "",
    generated: false,
    firstPrompt: "",
    listeners: new Set(),
    modelOptions: [],
    initDone: false,
    inFlight: undefined,
    abort: new AbortController(),
  }));
}

/** Reset the per-session title state (call on `session_start`). */
export function resetSessionTitle(): void {
  const state = titleState();
  state.abort.abort();
  state.title = "";
  state.generated = false;
  state.firstPrompt = "";
  state.inFlight = undefined;
}

/** Abort any in-flight generation (call on `session_shutdown`). */
export function abortSessionTitle(): void {
  titleState().abort.abort();
}

/**
 * Capture the first user prompt (call from `before_agent_start` with
 * `event.prompt`). Only the first non-empty prompt is kept — it is the
 * session's intent; later prompts belong to follow-up turns.
 */
export function captureSessionFirstPrompt(prompt: string | undefined): void {
  const state = titleState();
  if (!state.firstPrompt && prompt && prompt.trim().length > 0) {
    state.firstPrompt = prompt;
  }
}

/** The latched title for the current session, or "" when none yet. */
export function getSessionTitle(): string {
  return titleState().title;
}

/**
 * Subscribe to title updates. The listener fires once, when a model-produced
 * title latches. Returns an unsubscribe function.
 */
export function onSessionTitle(listener: (title: string) => void): () => void {
  const state = titleState();
  state.listeners.add(listener);
  return () => {
    state.listeners.delete(listener);
  };
}

/**
 * Generate the session title once, from the first user prompt. Latches only
 * on a real model-produced title; retries (no-op until the first user prompt
 * lands, or after a transient failure) on every call otherwise. Concurrent
 * callers share one in-flight side-call.
 */
export async function ensureSessionTitle(ctx: ExtensionContext): Promise<void> {
  const state = titleState();
  if (state.generated) return;
  if (state.inFlight) return state.inFlight;

  const run = runEnsure(state, ctx);
  state.inFlight = run;
  try {
    await run;
  } finally {
    if (state.inFlight === run) state.inFlight = undefined;
  }
}

async function runEnsure(state: SessionTitleState, ctx: ExtensionContext): Promise<void> {
  try {
    const config = loadSessionTitleConfig();
    if (!config.enabled) {
      logger.debug("ensureSessionTitle: disabled, skipping");
      state.generated = true;
      return;
    }

    const model =
      (config.model ? (resolveModel(ctx.modelRegistry.getAvailable(), config.model) as AnyModel) : undefined) ??
      (ctx.model as AnyModel | undefined);
    const branch = ctx.sessionManager.getBranch();
    logger.debug(
      `ensureSessionTitle: model=${model ? `${model.provider}/${model.id}` : "(none)"} branchLen=${branch.length} firstPromptLen=${state.firstPrompt.length} generated=${state.generated}`,
    );
    const outcome = await summarizeSessionTitle({
      firstPrompt: state.firstPrompt,
      branch,
      model,
      modelRegistry: ctx.modelRegistry,
      fallbackTitle: "",
      signal: state.abort.signal,
    });
    logger.debug(`ensureSessionTitle: outcome fromModel=${outcome.fromModel} title=${JSON.stringify(outcome.title)}`);
    // Only latch when the model actually produced a title. A missing first
    // prompt (early session_start before the prompt is appended) or a failed
    // side-call returns fromModel:false — stay unlatched so the next call
    // retries.
    if (outcome.fromModel && outcome.title) {
      state.title = outcome.title;
      state.generated = true;
      logger.debug(`ensureSessionTitle: title latched = ${outcome.title}`);
      for (const listener of [...state.listeners]) {
        try {
          listener(outcome.title);
        } catch (e) {
          logger.debug(`onSessionTitle listener threw ${String(e).slice(0, 120)}`);
        }
      }
    }
  } catch (e) {
    logger.debug(`ensureSessionTitle threw ${String(e).slice(0, 120)} — retrying on the next call`);
  }
}

/**
 * Wire the shared service into a pi session: register the config items
 * (idempotent — safe to call from every consumer extension) and keep the
 * model dropdown populated from the registry.
 */
export function initSessionTitleService(pi: ExtensionAPI): void {
  const state = titleState();
  registerConfigItems(SESSION_TITLE_CONFIG_ID, [
    {
      key: "enabled",
      type: "boolean",
      label: "Enabled",
      value: () => loadSessionTitleConfig().enabled,
      description: "Generate a short session title from the first user prompt via a model side-call.",
      extensionLabel: "Session Title",
      order: 0,
    },
    {
      key: "model",
      type: "select",
      label: "Model",
      value: () => loadSessionTitleConfig().model,
      description: "Model used to generate the session title. Leave as (default) to use the current session model.",
      extensionLabel: "Session Title",
      order: 1,
      options: () => [{ label: "(session default)", value: "" }, ...state.modelOptions],
    },
  ]);
  if (state.initDone) return;
  state.initDone = true;
  pi.on("session_start", (_event, ctx) => {
    const models = ctx.modelRegistry.getAvailable();
    state.modelOptions = models.map((m) => ({
      label: `${m.provider}/${m.id}`,
      value: `${m.provider}/${m.id}`,
    }));
  });
}
