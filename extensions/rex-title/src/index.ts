import type { Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { serializeConversation } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled } from "@htwang-contrib/common/extension-disable";
import { getLocalRexContext, renameRexPane } from "@htwang-contrib/common/rex";
import { branchToMessages, isStaleCtxError } from "@htwang-contrib/common/session-cache";
import { executeSideCall } from "@htwang-contrib/common/side-call";
import { registerTuiCommands } from "@htwang-contrib/common/tui-commands";

const MAX_CONVERSATION_CHARS = 12_000;
const TITLE_MAX_CHARS = 60;
const MODEL_TIMEOUT_MS = 60_000;

const SYSTEM_PROMPT = [
  "You write concise titles for terminal coding-agent sessions.",
  "Identify the user's current goal and the main work in the transcript.",
  "Prefer the latest coherent task if the session changed direction.",
  "Use only transcript-supported facts and the conversation's primary language.",
  "Output one plain-text phrase of 3-10 words and at most 60 characters.",
  "No heading, prefix, markdown, quotes, explanation, or trailing punctuation.",
].join(" ");

export function buildTitlePrompt(messages: Message[]): string {
  const serialized = serializeConversation(messages);
  const conversation =
    serialized.length > MAX_CONVERSATION_CHARS ? serialized.slice(-MAX_CONVERSATION_CHARS) : serialized;
  return [
    "Create a short title for this coding session transcript, ordered oldest to newest.",
    "It may be truncated from the beginning; focus on the latest coherent task.",
    "",
    "<conversation>",
    conversation,
    "</conversation>",
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

async function updateRexTitle(pi: ExtensionAPI, ctx: ExtensionCommandContext, signal: AbortSignal): Promise<void> {
  await ctx.waitForIdle();
  if (signal.aborted) return;

  const messages = branchToMessages(ctx.sessionManager.getBranch());
  if (messages.length === 0) {
    ctx.ui.notify("Start a conversation before generating a Rex title.", "warning");
    return;
  }
  const model = ctx.model;
  if (!model) {
    ctx.ui.notify("No active model is available for Rex title generation.", "warning");
    return;
  }

  const rex = await getLocalRexContext(pi.exec);
  if (signal.aborted) return;
  const timeout = AbortSignal.timeout(MODEL_TIMEOUT_MS);
  const result = await executeSideCall({
    model,
    modelRegistry: ctx.modelRegistry,
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildTitlePrompt(messages), timestamp: Date.now() }],
    signal: AbortSignal.any([signal, timeout]),
    commandName: "rex-title",
  });
  if (timeout.aborted) {
    ctx.ui.notify("Rex title generation timed out.", "warning");
    return;
  }
  if (signal.aborted) return;
  if ("aborted" in result) {
    ctx.ui.notify("Rex title generation was cancelled.", "warning");
    return;
  }
  if (!result.ok) throw new Error(result.error);

  const title = parseTitle(result.answer);
  if (!title) throw new Error("Rex title generation returned an empty title.");
  await renameRexPane(pi.exec, rex, title);
  if (signal.aborted) return;
  ctx.ui.notify(`Rex pane renamed to "${title}".`, "info");
}

export default function rexTitleExtension(pi: ExtensionAPI): void {
  if (isExtensionDisabled("rex-title")) return;

  let inflight: AbortController | undefined;
  const cancelInflight = (): void => {
    inflight?.abort();
    inflight = undefined;
  };
  pi.on("session_start", cancelInflight);
  pi.on("session_shutdown", cancelInflight);

  registerTuiCommands(pi, (api) => {
    api.registerCommand("rex-title", {
      description: "Summarize this session and rename its Rex pane",
      handler: async (_args, ctx) => {
        if (inflight) {
          ctx.ui.notify("Rex title generation is already running.", "warning");
          return;
        }

        const controller = new AbortController();
        inflight = controller;
        try {
          await updateRexTitle(api, ctx, controller.signal);
        } catch (error) {
          if (isStaleCtxError(error)) return;
          if (!controller.signal.aborted) {
            ctx.ui.notify(
              `Could not update Rex title: ${error instanceof Error ? error.message : String(error)}`,
              "error",
            );
          }
        } finally {
          if (inflight === controller) inflight = undefined;
        }
      },
    });
  });
}
