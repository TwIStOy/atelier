import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createLogger, MODAL_ACTIVE_EVENT } from "@htwang-contrib/common";
import { postReport } from "./client.ts";
import { loadConfig, registerHtwProducerConfigItems } from "./config.ts";
import { DiffTracker } from "./diff-tracker.ts";
import { createGitContextCache, type GitContextCache } from "./git-context.ts";
import { buildReport, type SessionStatus } from "./report.ts";

const logger = createLogger("htw-producer");
const HEARTBEAT_MS = 5_000;
const STARTED_ATS = new Map<string, number>();

interface ActiveSession {
  sessionId: string;
  startedAt: number;
  ctx: ExtensionContext;
  diff: DiffTracker;
  gitCache: GitContextCache;
  working: boolean;
  waiting: boolean;
  tool: { name: string; args: unknown } | undefined;
}

let active: ActiveSession | undefined;
let modalActive = false;
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

function computeStatus(session: ActiveSession): SessionStatus {
  if (session.waiting) return "waiting";
  if (session.working) return "working";
  return "idle";
}

function push(session: ActiveSession, status: SessionStatus): void {
  try {
    const cfg = loadConfig();
    if (!cfg.enabled) return;
    const report = buildReport({
      ctx: session.ctx,
      sessionId: session.sessionId,
      startedAt: session.startedAt,
      status,
      tool: session.tool,
      diff: session.diff.snapshot(),
      gitCache: session.gitCache,
      env: process.env,
      pid: process.pid,
    });
    void postReport(cfg.host, cfg.port, report).then((result) => {
      if (result.ok) {
        logger.debug(`posted ${report.status} (${report.context.percent}%)`);
      } else {
        logger.debug(`post failed: ${result.error ?? `http ${result.statusCode ?? "?"}`}`);
      }
    });
  } catch (err) {
    logger.debug(`push skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function bindContext(session: ActiveSession, ctx: ExtensionContext): void {
  session.ctx = ctx;
}

function startHeartbeat(): void {
  if (heartbeat !== undefined) return;
  heartbeat = setInterval(() => {
    const session = active;
    if (!session) return;
    push(session, computeStatus(session));
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
}

function stopHeartbeat(): void {
  if (heartbeat !== undefined) {
    clearInterval(heartbeat);
    heartbeat = undefined;
  }
}

export default function htwProducer(pi: ExtensionAPI): void {
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
      working: false,
      waiting: modalActive,
      tool: undefined,
    };
    bindContext(active, ctx);
    startHeartbeat();
    push(active, computeStatus(active));
  });
  pi.on("agent_start", (_event, ctx) => {
    if (!active) return;
    active.working = true;
    bindContext(active, ctx);
    push(active, computeStatus(active));
  });

  pi.on("agent_end", (_event, ctx) => {
    if (!active) return;
    active.working = false;
    active.tool = undefined;
    bindContext(active, ctx);
    push(active, computeStatus(active));
  });

  pi.on("tool_execution_start", (event, ctx) => {
    if (!active) return;
    active.working = true;
    active.tool = { name: event.toolName, args: event.args };
    active.diff.recordToolStart(event.toolName, event.args);
    bindContext(active, ctx);
    push(active, computeStatus(active));
  });

  pi.on("tool_execution_end", (_event, ctx) => {
    if (!active) return;
    active.tool = undefined;
    bindContext(active, ctx);
    push(active, computeStatus(active));
  });

  pi.events.on(MODAL_ACTIVE_EVENT, (data: unknown) => {
    modalActive = data === true;
    if (!active) return;
    active.waiting = modalActive;
    push(active, computeStatus(active));
  });

  pi.on("session_shutdown", () => {
    const session = active;
    if (session) {
      push(session, "ended");
      STARTED_ATS.delete(session.sessionId);
    }
    stopHeartbeat();
    active = undefined;
  });
}
