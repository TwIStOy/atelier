import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { type Component, Text, type TUI } from "@earendil-works/pi-tui";
import { DEFAULT_SPINNER, resolveSpinner } from "@htwang-contrib/common";
import type { WorkflowAgentSnapshot, WorkflowSnapshot, WorkflowStatus } from "./engine.ts";

const AGENT_ICONS: Record<WorkflowAgentSnapshot["status"], string> = {
  queued: "◌",
  running: "●",
  done: "✓",
  error: "✗",
  aborted: "–",
};

const STATUS_TEXT: Record<WorkflowSnapshot["status"], string> = {
  running: "running",
  done: "done",
  error: "failed",
  aborted: "aborted",
};

function elapsedSeconds(snapshot: WorkflowSnapshot): number {
  const end = snapshot.endedAt ?? Date.now();
  return Math.max(0, Math.round((end - snapshot.startedAt) / 1000));
}

function formatAgentLine(agent: WorkflowAgentSnapshot): string {
  const icon = AGENT_ICONS[agent.status];
  const parts = [`#${agent.id} ${agent.label}`];
  if (agent.toolCalls > 0) parts.push(`${agent.toolCalls} tool calls`);
  if (agent.status === "error" && agent.detail) parts.push(agent.detail);
  return `${icon} ${parts.join(" · ")}`;
}

export function renderWorkflowLines(snapshot: WorkflowSnapshot, maxLogs = 2): string[] {
  const total = snapshot.agents.length;
  const settled = snapshot.agents.filter((a) => a.status === "done" || a.status === "error").length;
  const lines: string[] = [
    `◆ Workflow: ${snapshot.name} — ${STATUS_TEXT[snapshot.status]} (${settled}/${total} agents, ${elapsedSeconds(snapshot)}s)`,
  ];

  const phaseless = snapshot.agents.filter((a) => a.phase === null);
  for (const agent of phaseless) {
    lines.push(`  ${formatAgentLine(agent)}`);
  }
  for (const phase of snapshot.phases) {
    const icon = phase.status === "active" ? "▶" : "✓";
    lines.push(`  ${icon} ${phase.title}`);
    for (const agent of snapshot.agents.filter((a) => a.phase === phase.title)) {
      lines.push(`    ${formatAgentLine(agent)}`);
    }
  }
  const recentLogs = snapshot.logs.slice(-maxLogs);
  for (const log of recentLogs) {
    lines.push(`  … ${log}`);
  }
  return lines;
}

const STATUS_COLORS: Record<WorkflowStatus, ThemeColor> = {
  running: "accent",
  done: "success",
  error: "error",
  aborted: "warning",
};

const SPINNER = resolveSpinner(DEFAULT_SPINNER);

function spinnerFrame(now: number): string {
  return SPINNER.frames[Math.floor(now / SPINNER.intervalMs) % SPINNER.frames.length] ?? SPINNER.frames[0]!;
}

function themedAgentGlyph(agent: WorkflowAgentSnapshot, theme: Theme, now: number): string {
  switch (agent.status) {
    case "done":
      return theme.fg("success", "✓");
    case "error":
      return theme.fg("error", "✗");
    case "aborted":
      return theme.fg("muted", "–");
    case "running":
      return theme.fg("accent", spinnerFrame(now));
    default:
      return theme.fg("dim", "◌");
  }
}

function formatAgentLineThemed(agent: WorkflowAgentSnapshot, theme: Theme, now: number): string {
  let line = `${themedAgentGlyph(agent, theme, now)} ${theme.fg("toolOutput", `#${agent.id} ${agent.label}`)}`;
  if (agent.toolCalls > 0) {
    line += theme.fg("dim", ` · ${agent.toolCalls} tool calls`);
  }
  if (agent.status === "error" && agent.detail) {
    line += theme.fg("error", ` — ${agent.detail}`);
  }
  return line;
}

export function renderWorkflowLinesThemed(snapshot: WorkflowSnapshot, theme: Theme, maxLogs = 2): string[] {
  const now = Date.now();
  const total = snapshot.agents.length;
  const settled = snapshot.agents.filter((a) => a.status === "done" || a.status === "error").length;
  const lines: string[] = [
    theme.fg("toolTitle", theme.bold("◆ Workflow: ")) +
      theme.fg("accent", snapshot.name) +
      theme.fg("muted", " — ") +
      theme.fg(STATUS_COLORS[snapshot.status], STATUS_TEXT[snapshot.status]) +
      theme.fg("dim", ` (${settled}/${total} agents, ${elapsedSeconds(snapshot)}s)`),
  ];

  const phaseless = snapshot.agents.filter((a) => a.phase === null);
  for (const agent of phaseless) {
    lines.push(`  ${formatAgentLineThemed(agent, theme, now)}`);
  }
  for (const phase of snapshot.phases) {
    const icon =
      phase.status === "active"
        ? `${theme.fg("accent", "▶")} ${theme.fg("toolOutput", phase.title)}`
        : `${theme.fg("success", "✓")} ${theme.fg("muted", phase.title)}`;
    lines.push(`  ${icon}`);
    for (const agent of snapshot.agents.filter((a) => a.phase === phase.title)) {
      lines.push(`    ${formatAgentLineThemed(agent, theme, now)}`);
    }
  }
  const recentLogs = snapshot.logs.slice(-maxLogs);
  for (const log of recentLogs) {
    lines.push(theme.fg("dim", `  … ${log}`));
  }
  return lines;
}

export type WorkflowDisplay = {
  update(snapshot: WorkflowSnapshot): void;
  finish(snapshot: WorkflowSnapshot): void;
};

const MIN_UPDATE_INTERVAL_MS = 100;
const ELAPSED_TICK_INTERVAL_MS = 1_000;
const WIDGET_CLEAR_DELAY_MS = 15_000;

type TickerState = {
  interval: ReturnType<typeof setInterval> | undefined;
  latest: WorkflowSnapshot | undefined;
};

function startElapsedTicker(state: TickerState, push: (snapshot: WorkflowSnapshot) => void): void {
  if (state.interval !== undefined) return;
  state.interval = setInterval(() => {
    const snapshot = state.latest;
    if (snapshot?.status !== "running") return;
    push(snapshot);
  }, ELAPSED_TICK_INTERVAL_MS);
  if (typeof state.interval.unref === "function") state.interval.unref();
}

function stopElapsedTicker(state: TickerState): void {
  if (state.interval === undefined) return;
  clearInterval(state.interval);
  state.interval = undefined;
}

type WidgetContent = ((tui: TUI, theme: Theme) => Component & { dispose?(): void }) | undefined;

type WidgetUi = {
  setWidget(key: string, content: WidgetContent, options?: { placement?: "aboveEditor" }): void;
};

const WIDGET_OPTIONS = { placement: "aboveEditor" as const };

export function createWidgetWorkflowDisplay(ui: WidgetUi, key = "workflow"): WorkflowDisplay {
  let lastPush = 0;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  let clearer: ReturnType<typeof setTimeout> | undefined;
  const ticker: TickerState = { interval: undefined, latest: undefined };

  const push = (snapshot: WorkflowSnapshot) => {
    ui.setWidget(key, (_tui, theme) => new Text(renderWorkflowLinesThemed(snapshot, theme).join("\n")), WIDGET_OPTIONS);
    lastPush = Date.now();
  };

  const cancelClearer = () => {
    if (clearer !== undefined) {
      clearTimeout(clearer);
      clearer = undefined;
    }
  };

  return {
    update(snapshot) {
      cancelClearer();
      ticker.latest = snapshot;
      startElapsedTicker(ticker, push);
      if (trailing !== undefined) return;
      const since = Date.now() - lastPush;
      if (since >= MIN_UPDATE_INTERVAL_MS) {
        push(snapshot);
        return;
      }
      trailing = setTimeout(() => {
        trailing = undefined;
        if (ticker.latest) push(ticker.latest);
      }, MIN_UPDATE_INTERVAL_MS - since);
      if (typeof trailing.unref === "function") trailing.unref();
    },
    finish(snapshot) {
      cancelClearer();
      stopElapsedTicker(ticker);
      if (trailing !== undefined) {
        clearTimeout(trailing);
        trailing = undefined;
      }
      push(snapshot);
      clearer = setTimeout(() => {
        ui.setWidget(key, undefined);
        clearer = undefined;
      }, WIDGET_CLEAR_DELAY_MS);
      if (typeof clearer.unref === "function") clearer.unref();
    },
  };
}

export function createStreamingWorkflowDisplay(
  onUpdate: ((partial: AgentToolResult<unknown>) => void) | undefined,
): WorkflowDisplay {
  let lastPush = 0;
  let trailing: ReturnType<typeof setTimeout> | undefined;
  const ticker: TickerState = { interval: undefined, latest: undefined };

  const push = (snapshot: WorkflowSnapshot) => {
    onUpdate?.({
      content: [{ type: "text", text: renderWorkflowLines(snapshot).join("\n") }],
      details: { workflow: snapshot },
    });
    lastPush = Date.now();
  };

  return {
    update(snapshot) {
      if (!onUpdate) return;
      ticker.latest = snapshot;
      startElapsedTicker(ticker, push);
      if (trailing !== undefined) return;
      const since = Date.now() - lastPush;
      if (since >= MIN_UPDATE_INTERVAL_MS) {
        push(snapshot);
        return;
      }
      trailing = setTimeout(() => {
        trailing = undefined;
        if (ticker.latest) push(ticker.latest);
      }, MIN_UPDATE_INTERVAL_MS - since);
      if (typeof trailing.unref === "function") trailing.unref();
    },
    finish(_snapshot) {
      stopElapsedTicker(ticker);
      if (trailing !== undefined) {
        clearTimeout(trailing);
        trailing = undefined;
      }
    },
  };
}
