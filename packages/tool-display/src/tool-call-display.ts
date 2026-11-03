import { type Theme, truncateToVisualLines } from "@earendil-works/pi-coding-agent";
import { Container, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import {
  type RailSpec,
  type RailStatus,
  renderRailLines,
  toolRailBodyWidth,
  trimTrailingEmpty,
  truncateDisplay,
} from "@htwang-contrib/common";
import { formatExpandedToolOutputLines } from "./adapters/shared.ts";
import { loadConfig } from "./config.ts";
import { formatDuration, spinnerGlyph, TIMER_MIN_ELAPSED_MS } from "./format.ts";
import { keyText } from "./key-text.ts";
import type { ContentRenderer, ToolDisplayAdapter } from "./types.ts";

export type { ContentRenderer, ToolDisplayAdapter };

export class ToolDisplayRegistry {
  private adapters = new Map<string, ToolDisplayAdapter>();

  register(toolName: string, adapter: ToolDisplayAdapter): void {
    this.adapters.set(toolName, adapter);
  }

  get(toolName: string): ToolDisplayAdapter | undefined {
    return this.adapters.get(toolName);
  }
}

// Points at the live registry; set by registry.ts so adapters (e.g. codemode,
// formatting nested calls) can resolve sibling adapters without an import cycle.
export const activeRegistryRef: { current?: ToolDisplayRegistry } = {};

export function formatToolArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return "";
  return entries
    .map(([k, v]) => {
      const val = typeof v === "string" ? v : JSON.stringify(v);
      return `${k}: ${truncateDisplay(val, 80)}`;
    })
    .join(", ");
}

export function snakeToCamelCase(s: string): string {
  return s
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function formatGenericToolHeader(
  toolName: string,
  args: Record<string, unknown>,
  theme: Theme,
  width: number,
  displayName?: string,
): string {
  const name = displayName ?? snakeToCamelCase(toolName);
  const namePart = theme.fg("toolTitle", theme.bold(name));
  const argStr = formatToolArgs(args);
  if (!argStr) return truncateToWidth(namePart, width, "…");

  const prefix = `${namePart} `;
  const argText = `(${argStr})`;
  const styledArg = theme.fg("dim", argText);
  const header = prefix + styledArg;

  if (visibleWidth(header) <= width) return header;

  const wrapped = wrapTextWithAnsi(styledArg, Math.max(1, width));
  const firstLine = truncateToWidth(prefix + wrapped[0], width, "…");
  const contLines = wrapped.slice(1).map((line) => truncateToWidth(line, width, "…"));
  return [firstLine, ...contLines].join("\n");
}

export function defaultGenericCollapsedRenderer(output: string, theme: Theme, width: number): string[] {
  if (!output.trim()) return [];
  const n = trimTrailingEmpty(output.split("\n")).length;
  const line = theme.fg("muted", `└ ${n} line${n !== 1 ? "s" : ""} — ${keyText("app.tools.expand")} to expand`);
  return [truncateToWidth(line, width, "…")];
}

function subagentRunFinished(details: unknown): "ok" | "err" | undefined {
  if (details == null || typeof details !== "object") return undefined;
  const d = details as Record<string, unknown>;
  const perTask = perTaskRunFinished(d);
  if (perTask !== undefined) return perTask;
  if (d.ok === true) return "ok";
  if (d.ok === false) return "err";
  return batchRunFinished(d);
}

function perTaskDoneComplete(perTaskDone: unknown): perTaskDone is unknown[] {
  return Array.isArray(perTaskDone) && perTaskDone.length > 0 && perTaskDone.every((x) => x === true);
}

function perTaskRunFinished(d: Record<string, unknown>): "ok" | "err" | undefined {
  const ptd = d.per_task_done;
  const pto = d.per_task_ok;
  if (!perTaskDoneComplete(ptd)) return undefined;
  if (!Array.isArray(pto) || pto.length !== ptd.length) return undefined;
  return pto.every((x) => x === true) ? "ok" : "err";
}

function batchRunFinished(d: Record<string, unknown>): "ok" | "err" | undefined {
  if (d.mode !== "batch" || !Array.isArray(d.batch)) return undefined;
  const b = d.batch as { ok?: boolean }[];
  if (b.length === 0 || !b.every((x) => typeof x.ok === "boolean")) return undefined;
  return b.every((x) => x.ok) ? "ok" : "err";
}

type BulletState = { spinning: boolean; failed: boolean };

export function toolBullet(
  toolName: string,
  isPartial: boolean,
  isError: boolean,
  details: unknown,
  theme: Theme,
  spinAt: number,
  hoverAffordance: boolean,
): { bullet: string; status?: RailStatus } {
  const state = bulletStateFor(toolName, isPartial, isError, details);
  if (state.spinning) return { bullet: spinnerGlyph(theme, spinAt) };
  return { bullet: hoverAffordance ? "›" : "◆", status: state.failed ? "error" : "success" };
}

function bulletStateFor(toolName: string, isPartial: boolean, isError: boolean, details: unknown): BulletState {
  switch (toolName) {
    case "subagent":
      return subagentBulletState(isPartial, isError, details);
    case "subagent_status":
      return subagentStatusBulletState(isError, details);
    case "workflow":
      return workflowBulletState(isPartial, isError, details);
    case "apply_patch":
      return applyPatchBulletState(isPartial, isError, details);
    default:
      return defaultBulletState(isPartial, isError);
  }
}

function defaultBulletState(isPartial: boolean, isError: boolean): BulletState {
  if (isPartial) return { spinning: true, failed: false };
  return { spinning: false, failed: isError };
}

function subagentBulletState(isPartial: boolean, isError: boolean, details: unknown): BulletState {
  const fin = subagentRunFinished(details);
  if (fin === "ok") return { spinning: false, failed: false };
  if (fin === "err") return { spinning: false, failed: true };
  return defaultBulletState(isPartial, isError);
}

function subagentStatusBulletState(isError: boolean, details: unknown): BulletState {
  const d = detailRecord(details);
  const st = statusString(d);
  if (st === "running") return { spinning: true, failed: false };
  if (subagentStatusFailed(st, d, isError)) return { spinning: false, failed: true };
  return { spinning: false, failed: false };
}

function statusString(d: Record<string, unknown> | undefined): string {
  return typeof d?.status === "string" ? d.status : "";
}

function subagentStatusFailed(st: string, d: Record<string, unknown> | undefined, isError: boolean): boolean {
  if (st === "unknown" || st === "error") return true;
  if (st === "done" && d?.ok === false) return true;
  return isError;
}

function workflowBulletState(isPartial: boolean, isError: boolean, details: unknown): BulletState {
  const d = detailRecord(details);
  if (d?.ok === true) return { spinning: false, failed: false };
  if (d?.ok === false) return { spinning: false, failed: true };
  return defaultBulletState(isPartial, isError);
}

function applyPatchBulletState(isPartial: boolean, isError: boolean, details: unknown): BulletState {
  const d = detailRecord(details);
  const r = typeof d?.result === "object" && d.result !== null ? (d.result as { failures?: unknown[] }) : undefined;
  if (r && Array.isArray(r.failures) && r.failures.length > 0) return { spinning: false, failed: true };
  return defaultBulletState(isPartial, isError);
}

function detailRecord(details: unknown): Record<string, unknown> | undefined {
  return details && typeof details === "object" ? (details as Record<string, unknown>) : undefined;
}

export function defaultCollapsedRenderer(content: string, theme: Theme, width: number): string[] {
  if (!content) return [];
  const previewLines = loadConfig().previewLines;
  const styledOutput = content
    .split("\n")
    .map((line) => theme.fg("toolOutput", line))
    .join("\n");

  const innerWidth = Math.max(1, width);
  const result = truncateToVisualLines(styledOutput, previewLines, innerWidth, 0);

  const lines: string[] = [];
  if (result.skippedCount > 0) {
    const hint = theme.fg("muted", `... (${result.skippedCount} more lines, ${keyText("app.tools.expand")} to expand)`);
    lines.push(truncateToWidth(hint, width, "…"));
  }
  lines.push(...result.visualLines);
  return lines;
}

export function defaultExpandedRenderer(content: string, theme: Theme, width: number): string[] {
  if (!content) return [];
  const lines = formatExpandedToolOutputLines(content, theme, width);
  const hint = theme.fg("muted", `${keyText("app.tools.expand")} to collapse`);
  lines.push(truncateToWidth(hint, width, "…"));
  return lines;
}

export function defaultGenericExpandedRenderer(output: string, theme: Theme, width: number): string[] {
  return defaultExpandedRenderer(output, theme, width);
}

export interface ToolCallDisplayOpts {
  toolName: string;
  args: Record<string, unknown>;
  output?: string;
  details?: unknown;
  expanded: boolean;
  isPartial: boolean;
  isError: boolean;
  registry?: ToolDisplayRegistry;
  renderCollapsed?: ContentRenderer;
  renderExpanded?: ContentRenderer;
  startedAtMs?: number;
  endedAtMs?: number;
  hoverAffordance?: boolean;
  displayName?: string;
  headerAnnotation?: string;
}

const ADAPTER_PARTIAL_PREVIEW_TOOLS = new Set(["grep", "glob", "ls"]);

function shouldUseAdapter(
  adapter: ToolDisplayAdapter | undefined,
  opts: ToolCallDisplayOpts,
): adapter is ToolDisplayAdapter {
  if (!adapter) return false;
  if (opts.expanded || opts.output) return true;
  if (collapsedWebSearchError(opts)) return true;
  if (opts.toolName === "subagent" || opts.toolName === "workflow" || opts.toolName === "codemode") return true;
  return opts.isPartial === true && ADAPTER_PARTIAL_PREVIEW_TOOLS.has(opts.toolName);
}

function collapsedWebSearchError(opts: ToolCallDisplayOpts): boolean {
  if (opts.toolName !== "web_search" || opts.expanded) return false;
  return detailsErrorPresent(opts.details);
}

function detailsErrorPresent(details: unknown): boolean {
  if (details == null || typeof details !== "object") return false;
  const error = (details as Record<string, unknown>).error;
  return typeof error === "string" && error.length > 0;
}

function renderHeaderLines(
  adapter: ToolDisplayAdapter | undefined,
  opts: ToolCallDisplayOpts,
  theme: Theme,
  width: number,
  spinAt: number,
): string[] {
  const bodyWidth = toolRailBodyWidth(width);
  const elapsedMs = opts.startedAtMs !== undefined ? (opts.endedAtMs ?? spinAt) - opts.startedAtMs : undefined;
  const timerLabel =
    elapsedMs !== undefined && elapsedMs >= TIMER_MIN_ELAPSED_MS ? formatDuration(elapsedMs) : undefined;
  const timerPart = timerLabel ? `${theme.fg("dim", timerLabel)} ` : "";
  const timerWidth = timerLabel ? visibleWidth(timerLabel) + 1 : 0;
  const innerWidth = Math.max(1, bodyWidth - timerWidth);

  const headerText = adapter
    ? adapter.formatCallHeader(
        opts.args,
        theme,
        opts.details,
        opts.isPartial,
        opts.expanded,
        innerWidth,
        opts.output,
        opts.headerAnnotation,
      )
    : formatGenericToolHeader(opts.toolName, opts.args, theme, innerWidth, opts.displayName);

  const headerLines = headerText.split("\n");
  if (timerPart) headerLines[0] = timerPart + headerLines[0];
  return headerLines;
}

function renderBodyLines(
  adapter: ToolDisplayAdapter | undefined,
  opts: ToolCallDisplayOpts,
  theme: Theme,
  width: number,
  spinAt: number,
): string[] {
  const bodyWidth = toolRailBodyWidth(width);
  const out = opts.output ?? "";
  if (showsErroredReason(opts, out)) return erroredReasonBody(adapter, opts, theme, bodyWidth, out);
  if (shouldUseAdapter(adapter, opts)) {
    return opts.expanded
      ? adapter.formatExpandedContent(opts.args, out, theme, bodyWidth, opts.details)
      : adapter.formatCollapsedContent(opts.args, out, theme, bodyWidth, opts.details, opts.isPartial, spinAt);
  }
  return fallbackBody(adapter, opts, theme, bodyWidth);
}

function showsErroredReason(opts: ToolCallDisplayOpts, out: string): boolean {
  if (opts.toolName === "codemode" || collapsedWebSearchError(opts)) return false;
  return opts.isError && !opts.isPartial && out.trim().length > 0;
}

function erroredReasonBody(
  adapter: ToolDisplayAdapter | undefined,
  opts: ToolCallDisplayOpts,
  theme: Theme,
  bodyWidth: number,
  out: string,
): string[] {
  const reason = out.replace(/\n+/g, " ").trim();
  if (!opts.expanded) {
    return [theme.fg("muted", truncateToWidth(`└ ${reason}`, bodyWidth, "…"))];
  }
  const lines: string[] = [];
  const icon = theme.fg("error", "\ue654 ");
  const cont = " ".repeat(visibleWidth(icon));
  const wrapWidth = Math.max(1, bodyWidth - visibleWidth(icon));
  const wrapped = wrapTextWithAnsi(reason, wrapWidth);
  wrapped.forEach((wl, i) => {
    const prefix = i === 0 ? icon : cont;
    lines.push(prefix + theme.fg("muted", truncateToWidth(wl, wrapWidth, "…")));
  });
  if (adapter) {
    lines.push(...adapter.formatExpandedContent(opts.args, out, theme, bodyWidth, opts.details));
  }
  return lines;
}

function fallbackBody(
  adapter: ToolDisplayAdapter | undefined,
  opts: ToolCallDisplayOpts,
  theme: Theme,
  bodyWidth: number,
): string[] {
  if (!opts.output) {
    if (!opts.isPartial && !opts.isError) return [theme.fg("muted", "done")];
    return [];
  }
  const collapsedRenderer =
    opts.renderCollapsed ?? (adapter ? defaultCollapsedRenderer : defaultGenericCollapsedRenderer);
  const expandedRenderer = opts.renderExpanded ?? (adapter ? defaultExpandedRenderer : defaultGenericExpandedRenderer);
  return opts.expanded
    ? expandedRenderer(opts.output, theme, bodyWidth)
    : collapsedRenderer(opts.output, theme, bodyWidth);
}

export function renderToolCall(
  opts: ToolCallDisplayOpts,
  theme: Theme,
): { render(width: number): string[]; invalidate(): void } {
  const adapter = opts.registry?.get(opts.toolName);

  return {
    render(width: number): string[] {
      const spinAt = Date.now();
      const bullet = toolBullet(
        opts.toolName,
        opts.isPartial,
        opts.isError,
        opts.details,
        theme,
        spinAt,
        opts.hoverAffordance === true,
      );
      const header = renderHeaderLines(adapter, opts, theme, width, spinAt);
      const body = renderBodyLines(adapter, opts, theme, width, spinAt);
      const spec: RailSpec = {
        mark: "run",
        bullet: bullet.bullet,
        status: bullet.status,
      };
      return renderRailLines([...header, ...body], spec, theme, width);
    },
    invalidate() {},
  };
}

export class ToolCallDisplayComponent extends Container {
  private opts: ToolCallDisplayOpts;
  private theme: Theme;

  constructor(opts: ToolCallDisplayOpts, theme: Theme) {
    super();
    this.opts = { startedAtMs: Date.now(), ...opts };
    this.theme = theme;
    this.rebuild();
  }

  private rebuild() {
    this.clear();
    this.addChild(renderToolCall(this.opts, this.theme));
  }
}
