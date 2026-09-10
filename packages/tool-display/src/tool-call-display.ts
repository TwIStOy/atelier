import { keyText, type Theme, truncateToVisualLines } from "@earendil-works/pi-coding-agent";
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
import { formatDuration, spinnerGlyph } from "./format.ts";
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

function snakeToCamelCase(s: string): string {
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
): string {
  const displayName = snakeToCamelCase(toolName);
  const namePart = theme.fg("toolTitle", theme.bold(displayName));
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
  const ptd = d.per_task_done;
  const pto = d.per_task_ok;
  if (
    Array.isArray(ptd) &&
    ptd.length > 0 &&
    ptd.every((x) => x === true) &&
    Array.isArray(pto) &&
    pto.length === ptd.length
  ) {
    return pto.every((x) => x === true) ? "ok" : "err";
  }
  if (d.ok === true) return "ok";
  if (d.ok === false) return "err";
  if (d.mode === "batch" && Array.isArray(d.batch)) {
    const b = d.batch as { ok?: boolean }[];
    if (b.length > 0 && b.every((x) => typeof x.ok === "boolean")) {
      return b.every((x) => x.ok) ? "ok" : "err";
    }
  }
  return undefined;
}

export function toolBullet(
  toolName: string,
  isPartial: boolean,
  isError: boolean,
  details: unknown,
  theme: Theme,
  spinAt: number,
  hoverAffordance: boolean,
): { bullet: string; status?: RailStatus } {
  let spinning = false;
  let failed = false;

  if (toolName === "subagent") {
    const fin = subagentRunFinished(details);
    if (fin === "ok") failed = false;
    else if (fin === "err") failed = true;
    else if (isPartial) spinning = true;
    else failed = isError;
  } else if (toolName === "subagent_status") {
    const d = details && typeof details === "object" ? (details as Record<string, unknown>) : undefined;
    const st = typeof d?.status === "string" ? d.status : "";
    if (st === "running") spinning = true;
    else if (st === "unknown" || st === "error" || (st === "done" && d?.ok === false) || isError) failed = true;
  } else if (toolName === "workflow") {
    const d = details && typeof details === "object" ? (details as Record<string, unknown>) : undefined;
    if (d?.ok === true) failed = false;
    else if (d?.ok === false) failed = true;
    else if (isPartial) spinning = true;
    else failed = isError;
  } else if (toolName === "apply_patch") {
    const d = details && typeof details === "object" ? (details as Record<string, unknown>) : undefined;
    const r = typeof d?.result === "object" && d.result !== null ? (d.result as { failures?: unknown[] }) : undefined;
    if (r && Array.isArray(r.failures) && r.failures.length > 0) failed = true;
    else if (isPartial) spinning = true;
    else failed = isError;
  } else {
    if (isPartial) spinning = true;
    else failed = isError;
  }

  if (spinning) return { bullet: spinnerGlyph(theme, spinAt) };
  return { bullet: hoverAffordance ? "›" : "◆", status: failed ? "error" : "success" };
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
}

export function renderToolCall(
  opts: ToolCallDisplayOpts,
  theme: Theme,
): { render(width: number): string[]; invalidate(): void } {
  const adapter = opts.registry?.get(opts.toolName);

  return {
    render(width: number): string[] {
      const spinAt = Date.now();
      const elapsedMs = opts.startedAtMs !== undefined ? (opts.endedAtMs ?? spinAt) - opts.startedAtMs : undefined;
      const bodyWidth = toolRailBodyWidth(width);
      const bullet = toolBullet(
        opts.toolName,
        opts.isPartial,
        opts.isError,
        opts.details,
        theme,
        spinAt,
        opts.hoverAffordance === true,
      );

      const timerLabel = elapsedMs !== undefined ? formatDuration(elapsedMs) : undefined;
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
          )
        : formatGenericToolHeader(opts.toolName, opts.args, theme, innerWidth);

      const headerLines = headerText.split("\n");
      if (timerPart) headerLines[0] = timerPart + headerLines[0];
      const lines = [...headerLines];

      const out = opts.output ?? "";
      const hasTextOutput = Boolean(out);
      const detailsOnlyCollapsed =
        opts.toolName === "subagent" && !opts.expanded && !opts.isPartial && opts.details !== undefined;

      const grepCollapsedPartial = opts.toolName === "grep" && !opts.expanded && opts.isPartial;

      const globCollapsedPartial = opts.toolName === "glob" && !opts.expanded && opts.isPartial;

      const lsCollapsedPartial = opts.toolName === "ls" && !opts.expanded && opts.isPartial;

      const useAdapter =
        adapter &&
        (opts.expanded ||
          hasTextOutput ||
          detailsOnlyCollapsed ||
          grepCollapsedPartial ||
          globCollapsedPartial ||
          lsCollapsedPartial ||
          (opts.toolName === "subagent" && !opts.expanded) ||
          (opts.toolName === "workflow" && !opts.expanded));

      const erroredReason = opts.isError && !opts.isPartial && out.trim().length > 0;

      if (erroredReason) {
        const reason = out.replace(/\n+/g, " ").trim();
        if (opts.expanded) {
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
        } else {
          lines.push(theme.fg("muted", truncateToWidth(`└ ${reason}`, bodyWidth, "…")));
        }
      } else if (useAdapter) {
        const contentLines = opts.expanded
          ? adapter.formatExpandedContent(opts.args, out, theme, bodyWidth, opts.details)
          : adapter.formatCollapsedContent(opts.args, out, theme, bodyWidth, opts.details, opts.isPartial, spinAt);
        lines.push(...contentLines);
      } else if (opts.output) {
        const collapsedRenderer =
          opts.renderCollapsed ?? (adapter ? defaultCollapsedRenderer : defaultGenericCollapsedRenderer);
        const expandedRenderer =
          opts.renderExpanded ?? (adapter ? defaultExpandedRenderer : defaultGenericExpandedRenderer);
        const contentLines = opts.expanded
          ? expandedRenderer(opts.output, theme, bodyWidth)
          : collapsedRenderer(opts.output, theme, bodyWidth);
        lines.push(...contentLines);
      } else if (!opts.isPartial && !opts.isError) {
        lines.push(theme.fg("muted", "done"));
      }

      const spec: RailSpec = {
        mark: "run",
        bullet: bullet.bullet,
        status: bullet.status,
      };
      return renderRailLines(lines, spec, theme, width);
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

  update(opts: Partial<ToolCallDisplayOpts>) {
    Object.assign(this.opts, opts);
    this.rebuild();
    this.invalidate();
  }

  setExpanded(expanded: boolean) {
    if (this.opts.expanded !== expanded) {
      this.opts.expanded = expanded;
      this.rebuild();
      this.invalidate();
    }
  }
}
