import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import {
  ASK_USER_PROMPT_EVENT,
  MODAL_ACTIVE_EVENT,
  registerConfigItems,
  type AskUserPromptPayload,
} from "@htwang-contrib/common";
import {
  isInsideHerdr,
  isActivePane,
  readHerdrEnv,
  renameTab,
  type PaneId,
  type TabId,
} from "./herdr-client.ts";
import {
  buildTabTitle,
  summarizeAskUserQuestion,
  type AgentState,
} from "./state.ts";
import {
  loadConfig,
  resolveSummaryModel,
  summarizeSessionTitle,
} from "./summarizer.ts";

type AnyModel = Model<any>;

let cachedModels: Array<{ label: string; value: string }> = [];

export function setCachedModels(
  models: Array<{ label: string; value: string }>,
): void {
  cachedModels = models;
}

const DEFAULT_TITLE = "Pi";

export default function herdrExtension(pi: ExtensionAPI): void {
  // Only take effect inside herdr-managed panes.
  if (!isInsideHerdr()) return;

  const env = readHerdrEnv();
  const paneId = env.paneId as PaneId;
  const tabId = env.tabId as TabId | undefined;

  // No tab to rename → nothing to do.
  if (!tabId) return;

  registerConfigItems("herdr", [
    {
      key: "enabled",
      type: "boolean",
      label: "Enable Tab Title",
      value: () => loadConfig().enabled,
      description:
        "When on, rename the herdr tab to a short summary of the current session.",
      extensionLabel: "Pi-Herdr",
      order: 0,
    },
    {
      key: "model",
      type: "select",
      label: "Summary Model",
      value: () => loadConfig().model,
      description:
        "Model used to summarize the session for the tab title. Leave as (default) to use the current session model.",
      extensionLabel: "Pi-Herdr",
      order: 1,
      options: () => [
        { label: "(session default)", value: "" },
        ...cachedModels,
      ],
    },
  ]);

  let currentState: AgentState = "idle";
  let sessionTitle = DEFAULT_TITLE; // cached title from the first user prompt
  let titleGenerated = false; // one-shot guard: title only depends on the first prompt
  let waitingBody = ""; // transient question text shown only while waiting
  let pendingQuestion: AskUserPromptPayload | null = null;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  const renderAbort = new AbortController();

  let cachedModelsBound = false;

  function refreshModelCache(ctx: ExtensionContext): void {
    if (cachedModelsBound) return;
    const models = ctx.modelRegistry.getAvailable();
    cachedModels = models.map((m) => ({
      label: `${m.provider}/${m.id}`,
      value: `${m.provider}/${m.id}`,
    }));
    cachedModelsBound = true;
  }

  /**
   * Generate the session title once, from the first user prompt. No-op after
   * the first success — the first prompt is stable for the whole session.
   */
  async function ensureSessionTitle(ctx: ExtensionContext): Promise<void> {
    if (titleGenerated) return;
    const config = loadConfig();
    if (!config.enabled) {
      sessionTitle = DEFAULT_TITLE;
      titleGenerated = true;
      return;
    }

    const model =
      resolveSummaryModel(ctx.modelRegistry, config) ??
      (ctx.model as AnyModel | undefined);
    const branch = ctx.sessionManager.getBranch();
    try {
      const outcome = await summarizeSessionTitle({
        branch,
        model,
        modelRegistry: ctx.modelRegistry,
        fallbackTitle: sessionTitle,
        signal: renderAbort.signal,
      });
      if (outcome.title) sessionTitle = outcome.title;
    } catch {
      // Keep the previous title on any failure.
    }
    // Mark generated once we have any result (even a fallback) so we don't
    // retry every turn — the first prompt won't change.
    titleGenerated = true;
  }

  function scheduleRender(delayMs = 150): void {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      void renderNow();
    }, delayMs);
  }

  async function renderNow(): Promise<void> {
    const config = loadConfig();
    // While waiting on a question, show the question text instead of the
    // cached summary; the summary is preserved across the question cycle.
    const body = config.enabled
      ? currentState === "waiting"
        ? waitingBody
        : sessionTitle
      : "";
    const title = buildTabTitle(currentState, body);
    // Only touch the tab when our pane is the focused one — otherwise we'd
    // overwrite the title the user is currently reading in another pane.
    const active = await safeIsActivePane();
    if (!active) return;
    try {
      await renameTab(pi, tabId, title);
    } catch {
      // Swallow herdr CLI failures — never break the agent turn.
    }
  }

  async function safeIsActivePane(): Promise<boolean> {
    try {
      return await isActivePane(pi, paneId);
    } catch {
      // If herdr is unreachable, assume active so we still set an initial title.
      return true;
    }
  }

  pi.on("session_start", (_event, ctx) => {
    refreshModelCache(ctx);
    currentState = "idle";
    sessionTitle = DEFAULT_TITLE;
    titleGenerated = false;
    waitingBody = "";
    pendingQuestion = null;
    // A resumed session may already have a first prompt — generate the title
    // up front so the tab isn't stuck on the default.
    void ensureSessionTitle(ctx).then(() => scheduleRender(0));
  });

  pi.on("before_agent_start", (_event, ctx) => {
    refreshModelCache(ctx);
    if (currentState === "waiting") return; // a question is still open
    currentState = "running";
    pendingQuestion = null;
    // The very first turn of a fresh session: the first prompt just landed.
    void ensureSessionTitle(ctx);
    scheduleRender();
  });

  pi.on("agent_end", () => {
    currentState = "idle";
    pendingQuestion = null;
    scheduleRender();
  });

  pi.events.on(ASK_USER_PROMPT_EVENT, (data: unknown) => {
    pendingQuestion = (data as AskUserPromptPayload) ?? null;
  });

  pi.events.on(MODAL_ACTIVE_EVENT, (active: unknown) => {
    if (active === true) {
      currentState = "waiting";
      // Use the captured question text as the transient body; sessionTitle
      // is left intact so it reappears once the question is answered.
      waitingBody = summarizeAskUserQuestion(pendingQuestion);
      scheduleRender();
      return;
    }
    if (currentState === "waiting") {
      currentState = "running";
      waitingBody = "";
      scheduleRender();
    }
  });

  pi.on("session_shutdown", () => {
    renderAbort.abort();
    if (renderTimer) clearTimeout(renderTimer);
  });
}
