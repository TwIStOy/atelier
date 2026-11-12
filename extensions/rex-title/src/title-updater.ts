import type { Message, UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { createLogger } from "@htwang-contrib/common/log";
import { extractMessageText } from "@htwang-contrib/common/message-text";
import { getLocalRexContext, renameRexPane } from "@htwang-contrib/common/rex";
import { isStaleCtxError } from "@htwang-contrib/common/session-cache";
import { executeSideCall } from "@htwang-contrib/common/side-call";
import { loadRexTitleConfig, resolveRexTitleModel } from "./config.ts";

const MAX_TITLE_TRANSCRIPT_CHARS = 16_000;
const TITLE_MAX_CHARS = 60;
const MODEL_TIMEOUT_MS = 60_000;

const logger = createLogger("rex-title");

const SYSTEM_PROMPT = [
  "You write concise titles for terminal coding-agent sessions.",
  "Read all numbered user requests as one evolving session, not as separate tasks.",
  "Synthesize their shared goal, refinements, and latest direction into one stable title.",
  "Use only transcript-supported facts and the conversation's primary language.",
  "Output one plain-text phrase of 3-10 words and at most 60 characters.",
  "No heading, prefix, markdown, quotes, explanation, or trailing punctuation.",
].join(" ");

export function branchUserMessages(branch: SessionEntry[]): UserMessage[] {
  return branch
    .filter(
      (entry): entry is SessionEntry & { type: "message"; message: UserMessage } =>
        entry.type === "message" && entry.message.role === "user",
    )
    .map((entry) => entry.message);
}

export function buildTitlePrompt(messages: Message[]): string {
  const requests = messages
    .filter((message): message is UserMessage => message.role === "user")
    .map((message) => extractMessageText(message.content).trim())
    .filter(Boolean);
  if (requests.length === 0) return "";
  const charsPerRequest = Math.max(200, Math.floor(MAX_TITLE_TRANSCRIPT_CHARS / requests.length));
  const conversation = requests
    .map((text) =>
      text.length > charsPerRequest
        ? `${text.slice(0, Math.ceil(charsPerRequest / 2) - 1)}…${text.slice(-Math.floor(charsPerRequest / 2))}`
        : text,
    )
    .map((text, index) => `<request index="${index + 1}">\n${text}\n</request>`)
    .join("\n");
  return [
    "Synthesize a short title from every user request in this coding session, ordered oldest to newest.",
    "Requests may refine, correct, or redirect earlier ones. Account for all of them and emphasize the current direction.",
    "",
    conversation,
  ].join("\n");
}

export function parseTitle(rawAnswer: string): string {
  const cleaned = rawAnswer
    .replace(/[\s\p{Cc}]+/gu, " ")
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.:;。\s]+$/gu, "");
  const characters = Array.from(cleaned);
  if (characters.length <= TITLE_MAX_CHARS) return cleaned;
  return `${characters
    .slice(0, TITLE_MAX_CHARS - 1)
    .join("")
    .trimEnd()}…`;
}

export type TitleUpdateResult =
  | { ok: true; title: string }
  | { ok: false; error: string; cancelled?: boolean; timedOut?: boolean };

function failure(error: string, options: { cancelled?: boolean; timedOut?: boolean } = {}): TitleUpdateResult {
  return { ok: false, error, ...options };
}

async function updateTitle(pi: ExtensionAPI, ctx: ExtensionContext, signal: AbortSignal): Promise<TitleUpdateResult> {
  if (signal.aborted) return failure("Rex title generation was cancelled.", { cancelled: true });
  const messages = branchUserMessages(ctx.sessionManager.getBranch());
  if (messages.length === 0) return failure("Start a conversation before generating a Rex title.");

  const config = loadRexTitleConfig();
  const model = config.model ? resolveRexTitleModel(ctx.modelRegistry, config) : ctx.model;
  if (!model)
    return failure("No model is available for Rex title generation. Check Rex Title > Title Model in /config.");

  const rex = await getLocalRexContext(pi.exec);
  if (signal.aborted) return failure("Rex title generation was cancelled.", { cancelled: true });
  const prompt = buildTitlePrompt(messages);
  if (!prompt) return failure("Add a non-empty user message before generating a Rex title.");
  const timeout = AbortSignal.timeout(MODEL_TIMEOUT_MS);
  const result = await executeSideCall({
    model,
    modelRegistry: ctx.modelRegistry,
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
    signal: AbortSignal.any([signal, timeout]),
    commandName: "rex-title",
  });
  if (timeout.aborted) return failure("Rex title generation timed out.", { timedOut: true });
  if (signal.aborted) return failure("Rex title generation was cancelled.", { cancelled: true });
  if ("aborted" in result) return failure("Rex title generation was cancelled.", { cancelled: true });
  if (!result.ok) return failure(result.error);

  const title = parseTitle(result.answer);
  if (!title) return failure("Rex title generation returned an empty title.");
  await renameRexPane(pi.exec, rex, title);
  if (signal.aborted) return failure("Rex title generation was cancelled.", { cancelled: true });
  return { ok: true, title };
}

export interface TitleUpdater {
  refresh(ctx: ExtensionContext): void;
  run(ctx: ExtensionContext): Promise<TitleUpdateResult>;
  cancel(): void;
}

export function createTitleUpdater(pi: ExtensionAPI): TitleUpdater {
  let inflight: AbortController | undefined;

  async function run(ctx: ExtensionContext): Promise<TitleUpdateResult> {
    inflight?.abort();
    const controller = new AbortController();
    inflight = controller;
    try {
      return await updateTitle(pi, ctx, controller.signal);
    } catch (error) {
      if (isStaleCtxError(error) || controller.signal.aborted) {
        return failure("Rex title generation was cancelled.", { cancelled: true });
      }
      return failure(error instanceof Error ? error.message : String(error));
    } finally {
      if (inflight === controller) inflight = undefined;
    }
  }

  return {
    refresh(ctx) {
      void run(ctx).then((result) => {
        if (!result.ok && !result.cancelled) logger.debug(`Rex title refresh failed: ${result.error}`);
      });
    },
    run,
    cancel() {
      inflight?.abort();
      inflight = undefined;
    },
  };
}
