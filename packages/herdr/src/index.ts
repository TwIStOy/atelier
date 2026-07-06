import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  ASK_USER_PROMPT_EVENT,
  type AskUserPromptPayload,
  createLogger,
  MODAL_ACTIVE_EVENT,
  registerConfigItems,
} from "@htwang-contrib/common";
import {
  getTabLabel,
  isInsideHerdr,
  type PaneId,
  readHerdrEnv,
  renameTab,
  resolveTabId,
  type TabId,
} from "./herdr-client.ts";
import { type AgentState, buildTabTitle, summarizeAskUserQuestion } from "./state.ts";
import { loadConfig, resolveSummaryModel, summarizeSessionTitle } from "./summarizer.ts";

type AnyModel = Model<any>;

const logger = createLogger("herdr");

let cachedModels: Array<{ label: string; value: string }> = [];

export function setCachedModels(models: Array<{ label: string; value: string }>): void {
  cachedModels = models;
}

const DEFAULT_TITLE = "Pi";

export default function herdrExtension(pi: ExtensionAPI): void {
  logger.info("extension loaded");
  // Config items are registered unconditionally so users can pre-set the
  // summary model from /config even when pi is not running inside herdr.
  // The herdr-only *behavior* is gated below.
  registerConfigItems("herdr", [
    {
      key: "enabled",
      type: "boolean",
      label: "Enable Tab Title",
      value: () => loadConfig().enabled,
      description: "When on, rename the herdr tab to a short summary of the current session.",
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
      options: () => [{ label: "(session default)", value: "" }, ...cachedModels],
    },
  ]);

  // Populate the model dropdown regardless of environment, so the option
  // list is ready when the user opens /config.
  pi.on("session_start", (_event, ctx) => {
    const models = ctx.modelRegistry.getAvailable();
    cachedModels = models.map((m) => ({
      label: `${m.provider}/${m.id}`,
      value: `${m.provider}/${m.id}`,
    }));
  });

  // Only take effect inside herdr-managed panes.
  if (!isInsideHerdr()) return;

  const env = readHerdrEnv();
  const paneId = env.paneId as PaneId;
  // tab_id is resolved lazily: HERDR_TAB_ID is not injected by all herdr
  // builds, so we fall back to reading it from `pane get`.
  let tabId: TabId | undefined = env.tabId;

  let currentState: AgentState = "idle";
  let sessionTitle = DEFAULT_TITLE; // cached title from the first user prompt
  let titleGenerated = false; // latches true only after a real model-produced title
  let firstPrompt = ""; // captured from before_agent_start event.prompt (sync, before branch persist)
  let waitingBody = ""; // transient question text shown only while waiting
  let pendingQuestion: AskUserPromptPayload | null = null;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;
  const renderAbort = new AbortController();
  // Snapshot of the user's original tab label (restored on shutdown). Captured
  // once, before the first rename, so we never store one of our own titles.
  let originalLabel: string | undefined;
  let originalNumber: number | undefined;
  let originalCaptured = false;

  /**
   * Generate the session title once, from the first user prompt. Latches
   * only on a real model-produced title; retries (no-op until the first user
   * prompt lands, or after a transient failure) on every event otherwise.
   */
  async function ensureSessionTitle(ctx: ExtensionContext): Promise<void> {
    if (titleGenerated) return;
    const config = loadConfig();
    if (!config.enabled) {
      logger.debug("ensureSessionTitle: disabled, skipping");
      sessionTitle = DEFAULT_TITLE;
      titleGenerated = true;
      return;
    }

    const model = resolveSummaryModel(ctx.modelRegistry, config) ?? (ctx.model as AnyModel | undefined);
    const branch = ctx.sessionManager.getBranch();
    logger.debug(
      `ensureSessionTitle: model=${model ? `${model.provider}/${model.id}` : "(none)"} branchLen=${branch.length} firstPromptLen=${firstPrompt.length} titleGenerated=${titleGenerated}`,
    );
    try {
      const outcome = await summarizeSessionTitle({
        firstPrompt,
        branch,
        model,
        modelRegistry: ctx.modelRegistry,
        fallbackTitle: sessionTitle,
        signal: renderAbort.signal,
      });
      logger.debug(`ensureSessionTitle: outcome fromModel=${outcome.fromModel} title=${JSON.stringify(outcome.title)}`);
      // Only latch when the model actually produced a title. A missing first
      // prompt (early session_start before the prompt is appended) or a failed
      // side-call returns a fallback with fromModel:false — leave
      // titleGenerated false so the next event retries.
      if (outcome.fromModel && outcome.title) {
        sessionTitle = outcome.title;
        titleGenerated = true;
        logger.debug(`ensureSessionTitle: summary latched = ${outcome.title}`);
        // The side-call is async (LLM latency). The render scheduled by the
        // triggering event ran BEFORE we had the title — re-render now so the
        // new title is pushed to the tab as soon as it lands.
        scheduleRender(0);
      }
    } catch (e) {
      logger.debug(`ensureSessionTitle: threw ${String(e).slice(0, 120)}`);
      // Keep the previous title and leave unlatched; retry on the next event.
    }
  }

  function scheduleRender(delayMs = 150): void {
    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      renderTimer = null;
      void renderNow();
    }, delayMs);
  }

  async function renderNow(): Promise<void> {
    // Resolve the tab id on demand if the env var was absent.
    if (!tabId) {
      tabId = await safeResolveTabId();
      if (!tabId) {
        logger.debug("renderNow: no tabId, aborting");
        return; // can't rename without a tab id
      }
    }
    // Snapshot the original label before our first overwrite, so we can
    // restore it on shutdown. Done once per session.
    if (!originalCaptured) {
      await safeCaptureOriginal();
    }
    const config = loadConfig();
    // While waiting on a question, show the question text instead of the
    // cached summary; the summary is preserved across the question cycle.
    const body = config.enabled ? (currentState === "waiting" ? waitingBody : sessionTitle) : "";
    const title = buildTabTitle(currentState, body);
    // Always rename: tabId is OUR tab (resolved from our own pane). The title
    // must reflect our live session state even when our pane is not focused —
    // otherwise a title change that lands while unfocused (e.g. an LLM
    // side-call resolving after the user switched panes) is lost forever.
    try {
      await renameTab(pi, tabId, title);
      logger.debug(`renderNow: rename OK -> ${title}`);
    } catch (e) {
      logger.debug(`renderNow: rename threw ${String(e).slice(0, 120)}`);
      // Swallow herdr CLI failures — never break the agent turn.
    }
  }

  async function safeResolveTabId(): Promise<TabId | undefined> {
    try {
      return await resolveTabId(pi, paneId);
    } catch {
      return undefined;
    }
  }

  async function safeCaptureOriginal(): Promise<void> {
    if (originalCaptured || !tabId) {
      originalCaptured = true;
      return;
    }
    try {
      const info = await getTabLabel(pi, tabId);
      const label = info?.label?.trim();
      const num = info?.number;
      originalNumber = typeof num === "number" ? num : undefined;
      // If the tab already shows one of our titles (a state icon prefix), it's
      // a leftover from a previous run — fall back to the tab number instead.
      originalLabel = label && !isOurTitle(label) ? label : originalNumber?.toString();
    } catch {
      originalLabel = originalNumber?.toString();
    }
    originalCaptured = true;
  }

  function isOurTitle(label: string): boolean {
    // State icons we emit are ⏺ / ❓ / ✓; any tab label starting with one is ours.
    return label.startsWith("⏺") || label.startsWith("❓") || label.startsWith("✓");
  }

  async function restoreOriginalLabel(): Promise<void> {
    // Resolve the tab id on demand (mirrors renderNow).
    if (!tabId) {
      tabId = await safeResolveTabId();
      if (!tabId) return;
    }
    // If we never captured the original (e.g. renderNow never ran because our
    // pane was never focused), capture it now so we can still restore on exit.
    if (!originalCaptured) {
      await safeCaptureOriginal();
    }
    // Prefer the original label; fall back to the tab number when we never
    // captured a user label (e.g. capture failed or it was already ours).
    const target = originalLabel ?? originalNumber?.toString();
    if (!target) return;
    try {
      await renameTab(pi, tabId, target);
    } catch {
      // Best-effort; don't throw during shutdown.
    }
  }

  pi.on("session_start", (_event, ctx) => {
    currentState = "idle";
    sessionTitle = DEFAULT_TITLE;
    titleGenerated = false;
    firstPrompt = "";
    waitingBody = "";
    pendingQuestion = null;
    // Re-snapshot the original tab label for this (possibly resumed) session.
    originalLabel = undefined;
    originalNumber = undefined;
    originalCaptured = false;
    // A resumed session may already have a first prompt on the branch — generate
    // the title up front so the tab isn't stuck on the default.
    void ensureSessionTitle(ctx).then(() => scheduleRender(0));
  });

  pi.on("before_agent_start", (event, ctx) => {
    if (currentState === "waiting") return; // a question is still open
    // Capture the first user prompt directly from the event — it is available
    // synchronously, before the prompt is persisted to the session branch
    // (which is why reading the branch at this point used to return "").
    if (!firstPrompt && event.prompt) {
      firstPrompt = event.prompt;
      logger.debug(`before_agent_start: captured firstPrompt len=${firstPrompt.length}`);
    }
    currentState = "running";
    pendingQuestion = null;
    // Generate the title now that we have the prompt — no need to wait for
    // the turn to finish; the latch guard makes this cheap.
    void ensureSessionTitle(ctx);
    scheduleRender();
  });

  pi.on("agent_end", (_event, ctx) => {
    currentState = "idle";
    pendingQuestion = null;
    // The first prompt may only be readable from the branch *after* the turn
    // completes (session_start/before_agent_start can fire before it is
    // appended). Retry here; the latch guard makes this cheap.
    void ensureSessionTitle(ctx).then(() => scheduleRender());
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
    // Restore the user's original tab label (or its number) on exit.
    void restoreOriginalLabel();
  });
}
