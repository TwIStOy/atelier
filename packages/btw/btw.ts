import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SessionCompactEvent,
  SessionTreeEvent,
} from "@earendil-works/pi-coding-agent";
import type { Message, UserMessage } from "@earendil-works/pi-ai";
import {
  branchToMessages,
  createSessionCache,
  executeSideCall,
  getGlobalState,
  userMessageText,
} from "@htwang-contrib/common";
import type { SideCallResult } from "@htwang-contrib/common";
import { showBtwOverlay } from "./btw-ui.ts";
import type { BtwTurn } from "./btw-ui.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const BTW_STATE_KEY = "htwang-contrib-btw";
const BTW_CACHE_KEY = "htwang-contrib-btw-snapshot";
const COMMAND_NAME = "/btw";
const CROSS_SESSION_LIMIT = 10;

interface BtwState {
  histories: Map<string, BtwTurn[]>;
}

const systemPrompt = loadSystemPrompt();

function loadSystemPrompt(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, "prompts", "btw-system.txt"), "utf-8").trim();
}

function getBtwState(): BtwState {
  return getGlobalState<BtwState>(BTW_STATE_KEY, () => ({
    histories: new Map(),
  }));
}

function sessionKey(ctx: ExtensionContext): string {
  return (
    ctx.sessionManager.getSessionFile() ??
    `memory:${ctx.sessionManager.getSessionId()}`
  );
}

function getSessionHistory(state: BtwState, ctx: ExtensionContext): BtwTurn[] {
  const key = sessionKey(ctx);
  let history = state.histories.get(key);
  if (!history) {
    history = [];
    state.histories.set(key, history);
  }
  return history;
}

export function clearSessionHistory(
  state: BtwState,
  ctx: ExtensionContext,
): void {
  const key = sessionKey(ctx);
  state.histories.set(key, []);
}

function buildBtwMessages(
  ctx: ExtensionContext,
  cache: ReturnType<typeof createSessionCache<Message[]>>,
  history: BtwTurn[],
  userMessage: UserMessage,
): Message[] {
  const branchMessages =
    cache.get(ctx) ?? branchToMessages(ctx.sessionManager.getBranch());
  const historyMessages = history.flatMap((h) => [
    h.userMessage,
    h.assistantMessage,
  ]);
  return [...branchMessages, ...historyMessages, userMessage];
}

function getCrossSessionHint(
  state: BtwState,
  currentSessionKey: string,
): string {
  const allQuestions: string[] = [];
  for (const [key, turns] of state.histories) {
    if (key === currentSessionKey) continue;
    for (const turn of turns) {
      allQuestions.push(userMessageText(turn.userMessage));
    }
  }
  if (allQuestions.length === 0) return "";
  const recent = allQuestions.slice(-CROSS_SESSION_LIMIT);
  const listed = recent.map((q, i) => `${i + 1}. ${q}`).join("\n");
  return `\n\nRecent /btw questions across sessions:\n${listed}`;
}

function registerMessageEndSnapshot(
  pi: ExtensionAPI,
  cache: ReturnType<typeof createSessionCache<Message[]>>,
): void {
  pi.on(
    "message_end",
    (event: { type: "message_end"; message: { role: string } }, ctx) => {
      if (event.message.role !== "assistant") return;
      const msgs = branchToMessages(ctx.sessionManager.getBranch());
      cache.set(ctx, msgs);
    },
  );
}

function registerInvalidationHooks(
  pi: ExtensionAPI,
  cache: ReturnType<typeof createSessionCache<Message[]>>,
): void {
  pi.on("session_compact", (_event: SessionCompactEvent, ctx) => {
    cache.safeInvalidate(ctx);
  });
  pi.on("session_tree", (_event: SessionTreeEvent, ctx) => {
    cache.safeInvalidate(ctx);
  });
}

async function handleBtwCommand(
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify(
      `${COMMAND_NAME} requires an interactive terminal.`,
      "warning",
    );
    return;
  }
  const question = args.trim();
  if (!question) {
    ctx.ui.notify(
      `${COMMAND_NAME} requires a question. Usage: /btw <question>`,
      "warning",
    );
    return;
  }
  if (!ctx.model) {
    ctx.ui.notify(`${COMMAND_NAME} requires an active model.`, "warning");
    return;
  }

  const state = getBtwState();
  const history = getSessionHistory(state, ctx);
  const cache = createSessionCache<Message[]>(BTW_CACHE_KEY);
  const controller = new AbortController();
  const key = sessionKey(ctx);

  const userMessage = {
    role: "user" as const,
    content: question,
    timestamp: Date.now(),
  } as UserMessage;
  const messages = buildBtwMessages(ctx, cache, history, userMessage);

  let fullSystemPrompt = systemPrompt;
  const hint = getCrossSessionHint(state, key);
  if (hint) fullSystemPrompt += hint;

  const { overlayPromise, controllerReady } = showBtwOverlay({
    ctx,
    question,
    history,
    controller,
    onClearHistory() {
      clearSessionHistory(state, ctx);
    },
  });

  const ctrl = await controllerReady;

  const result: SideCallResult = await executeSideCall({
    model: ctx.model,
    modelRegistry: ctx.modelRegistry,
    systemPrompt: fullSystemPrompt,
    messages,
    signal: controller.signal,
    commandName: COMMAND_NAME,
  });

  if (result.ok) {
    ctrl.setAnswer(result.answer);
    history.push({
      userMessage,
      assistantMessage: result.assistantMessage,
    });
  } else if (!result.ok && "aborted" in result) {
    ctrl.setError("Aborted.");
  } else if (!result.ok) {
    ctrl.setError(result.error);
  }

  await overlayPromise;
}

export function registerBtw(pi: ExtensionAPI): void {
  const cache = createSessionCache<Message[]>(BTW_CACHE_KEY);
  registerMessageEndSnapshot(pi, cache);
  registerInvalidationHooks(pi, cache);

  pi.registerCommand("btw", {
    description:
      "Ask a one-off side question to the current model. Answer appears in an overlay and does not enter the conversation.",
    async handler(args, ctx) {
      await handleBtwCommand(args, ctx);
    },
  });
}
