import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createLogger, isExtensionDisabled } from "@htwang-contrib/common";
import { postEvent, postReport } from "./client.ts";
import { loadConfig, registerHtwProducerConfigItems } from "./config.ts";
import { DiffTracker } from "./diff-tracker.ts";
import { buildEnvelope, type EventPayload, sessionKey } from "./event.ts";
import { createGitContextCache, type GitContextCache } from "./git-context.ts";
import { buildReport, type SessionStatus, summarizeToolArgs } from "./report.ts";

const logger = createLogger("htw-producer");
const HEARTBEAT_MS = 60_000;
const LAST_PROMPT_MAX_LEN = 500;
const STARTED_ATS = new Map<string, number>();

interface ActiveSession {
  sessionId: string;
  startedAt: number;
  ctx: ExtensionContext;
  diff: DiffTracker;
  gitCache: GitContextCache;
  status: SessionStatus;
  statusBeforeWaiting: SessionStatus;
  thinking: boolean;
  tool: { name: string; args: unknown } | undefined;
  lastUserInput: string | undefined;
  lastRunFailed: boolean;
}

let active: ActiveSession | undefined;
let heartbeat: ReturnType<typeof setInterval> | undefined;

function sessionId(ctx: ExtensionContext): string {
  const id = ctx.sessionManager.getSessionId();
  return id || `pi-${process.pid}`;
}

function startedAtFor(id: string): number {
  const existing = STARTED_ATS.get(id);
  if (existing) return existing;
  const now = Math.floor(Date.now() / 1000);
  STARTED_ATS.set(id, now);
  return now;
}

function bindContext(session: ActiveSession, ctx: ExtensionContext): void {
  session.ctx = ctx;
}

function sendEvent(session: ActiveSession, event: EventPayload): void {
  try {
    const cfg = loadConfig();
    if (!cfg.enabled) return;
    const envelope = buildEnvelope({
      ctx: session.ctx,
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      event,
      diff: session.diff.snapshot(),
      gitCache: session.gitCache,
      env: process.env,
      pid: process.pid,
    });
    void postEvent(cfg.host, cfg.port, envelope).then((result) => {
      if (result.ok) {
        logger.debug(`event ${event.type} posted`);
      } else {
        logger.debug(`event ${event.type} post failed: ${result.error ?? `http ${result.statusCode ?? "?"}`}`);
      }
    });
  } catch (err) {
    logger.debug(`event ${event.type} skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function pushSnapshot(session: ActiveSession): void {
  try {
    const cfg = loadConfig();
    if (!cfg.enabled) return;
    const report = buildReport({
      ctx: session.ctx,
      id: sessionKey(session.sessionId),
      startedAt: session.startedAt,
      status: session.status,
      tool: session.tool,
      thinking: session.thinking,
      lastUserInput: session.lastUserInput,
      diff: session.diff.snapshot(),
      gitCache: session.gitCache,
      env: process.env,
      pid: process.pid,
    });
    void postReport(cfg.host, cfg.port, report).then((result) => {
      if (result.ok) {
        logger.debug(`snapshot ${report.status} (${report.context.percent}%)`);
      } else {
        logger.debug(`snapshot post failed: ${result.error ?? `http ${result.statusCode ?? "?"}`}`);
      }
    });
  } catch (err) {
    logger.debug(`snapshot skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function startHeartbeat(): void {
  if (heartbeat !== undefined) return;
  heartbeat = setInterval(() => {
    const session = active;
    if (!session) return;
    pushSnapshot(session);
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
}

function stopHeartbeat(): void {
  if (heartbeat !== undefined) {
    clearInterval(heartbeat);
    heartbeat = undefined;
  }
}

function enterWaiting(session: ActiveSession): void {
  session.statusBeforeWaiting = session.status;
  session.status = "waiting";
}

function exitWaiting(session: ActiveSession): void {
  session.status = session.statusBeforeWaiting;
}

function truncatePrompt(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (line.length <= LAST_PROMPT_MAX_LEN) return line;
  return `${line.slice(0, LAST_PROMPT_MAX_LEN - 1)}…`;
}

function markWorking(session: ActiveSession): void {
  session.status = "working";
}

function finishRun(session: ActiveSession): void {
  session.status = session.lastRunFailed ? "error" : "idle";
  session.thinking = false;
  session.tool = undefined;
}

export default function htwProducer(pi: ExtensionAPI): void {
  if (isExtensionDisabled("htw-producer")) return;
  logger.info("extension loaded");
  registerHtwProducerConfigItems();

  pi.on("session_start", (_event, ctx) => {
    const id = sessionId(ctx);
    active = {
      sessionId: id,
      startedAt: startedAtFor(id),
      ctx,
      diff: new DiffTracker(),
      gitCache: createGitContextCache(),
      status: "idle",
      statusBeforeWaiting: "idle",
      thinking: false,
      tool: undefined,
      lastUserInput: undefined,
      lastRunFailed: false,
    };
    bindContext(active, ctx);
    startHeartbeat();
    sendEvent(active, { type: "session_started" });
  });

  pi.on("before_agent_start", (event, ctx) => {
    const session = active;
    if (!session) return;
    bindContext(session, ctx);
    const prompt = truncatePrompt(event.prompt);
    if (prompt.length === 0) return;
    session.lastUserInput = prompt;
    session.thinking = false;
    session.tool = undefined;
    markWorking(session);
    sendEvent(session, { type: "user_prompt", text: prompt });
  });

  pi.on("message_update", (event, ctx) => {
    const session = active;
    if (!session) return;
    const kind = event.assistantMessageEvent.type;
    if (kind === "thinking_start" && !session.thinking) {
      session.thinking = true;
      markWorking(session);
      bindContext(session, ctx);
      sendEvent(session, { type: "thinking_started" });
    } else if (kind === "thinking_end" && session.thinking) {
      session.thinking = false;
      bindContext(session, ctx);
      sendEvent(session, { type: "thinking_finished" });
    }
  });

  pi.on("tool_execution_start", (event, ctx) => {
    const session = active;
    if (!session) return;
    bindContext(session, ctx);
    session.tool = { name: event.toolName, args: event.args };
    session.diff.recordToolStart(event.toolName, event.args);
    markWorking(session);
    sendEvent(session, {
      type: "tool_started",
      name: event.toolName,
      args: summarizeToolArgs(event.toolName, event.args),
    });
  });

  pi.on("tool_execution_end", (_event, ctx) => {
    const session = active;
    if (!session) return;
    bindContext(session, ctx);
    session.tool = undefined;
    sendEvent(session, { type: "tool_finished" });
  });

  pi.on("ui_prompt_start", (_event, ctx) => {
    const session = active;
    if (!session) return;
    bindContext(session, ctx);
    enterWaiting(session);
    sendEvent(session, { type: "waiting_for_user" });
  });

  pi.on("ui_prompt_end", (_event, ctx) => {
    const session = active;
    if (!session) return;
    bindContext(session, ctx);
    exitWaiting(session);
  });

  pi.on("agent_end", (event, ctx) => {
    const session = active;
    if (!session) return;
    bindContext(session, ctx);
    for (let i = event.messages.length - 1; i >= 0; i--) {
      const message = event.messages[i];
      if (message && typeof message === "object" && (message as { role?: string }).role === "assistant") {
        session.lastRunFailed = (message as { stopReason?: string }).stopReason === "error";
        break;
      }
    }
  });

  pi.on("agent_settled", (_event, ctx) => {
    const session = active;
    if (!session) return;
    bindContext(session, ctx);
    sendEvent(session, { type: session.lastRunFailed ? "turn_failed" : "turn_completed" });
    finishRun(session);
    session.lastRunFailed = false;
  });

  pi.on("session_shutdown", () => {
    const session = active;
    if (session) {
      sendEvent(session, { type: "session_ended" });
      STARTED_ATS.delete(session.sessionId);
    }
    stopHeartbeat();
    active = undefined;
  });
}
