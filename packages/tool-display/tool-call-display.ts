import {
  keyText,
  Theme,
  truncateToVisualLines,
} from "@earendil-works/pi-coding-agent";
import { truncateDisplay, trimTrailingEmpty } from "@htwang-contrib/common";
import {
  Container,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { formatExpandedToolOutputLines } from "./adapters/shared.ts";
import { loadConfig } from "./config.ts";
import { spinnerGlyph } from "./format.ts";
import type { ContentRenderer, ToolDisplayAdapter } from "./types.ts";

export type { ContentRenderer, ToolDisplayAdapter };

const INDENT = "    ";

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

  const prefix = namePart + " ";
  const argText = `(${argStr})`;
  const styledArg = theme.fg("dim", argText);
  const header = prefix + styledArg;

  if (visibleWidth(header) <= width) return header;

  const wrapped = wrapTextWithAnsi(
    styledArg,
    Math.max(1, width - INDENT.length),
  );
  const firstLine = truncateToWidth(prefix + wrapped[0], width, "…");
  const contLines = wrapped
    .slice(1)
    .map((line) => INDENT + truncateToWidth(line, width - INDENT.length, "…"));
  return [firstLine, ...contLines].join("\n");
}

export function defaultGenericCollapsedRenderer(
  output: string,
  theme: Theme,
  width: number,
): string[] {
  if (!output.trim()) return [];
  const n = trimTrailingEmpty(output.split("\n")).length;
  const line =
    INDENT +
    theme.fg(
      "muted",
      `└ ${n} line${n !== 1 ? "s" : ""} — ${keyText("app.tools.expand")} to expand`,
    );
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

function makeHeader(
  toolName: string,
  args: Record<string, unknown>,
  adapter: ToolDisplayAdapter | undefined,
  isPartial: boolean,
  isError: boolean,
  theme: Theme,
  width: number,
  spinAt: number,
  expanded: boolean,
  details?: unknown,
): string[] {
  let statusIcon: string;
  if (toolName === "subagent") {
    const fin = subagentRunFinished(details);
    if (fin === "ok") statusIcon = theme.fg("success", "◆");
    else if (fin === "err") statusIcon = theme.fg("error", "◆");
    else if (isPartial) statusIcon = spinnerGlyph(theme, spinAt);
    else if (isError) statusIcon = theme.fg("error", "◆");
    else statusIcon = theme.fg("success", "◆");
  } else if (toolName === "subagent_status") {
    const d =
      details && typeof details === "object"
        ? (details as Record<string, unknown>)
        : undefined;
    const st = typeof d?.status === "string" ? d.status : "";
    if (st === "running") statusIcon = spinnerGlyph(theme, spinAt);
    else if (st === "unknown" || st === "error") {
      statusIcon = theme.fg("error", "◆");
    } else if (st === "done" && d?.ok === false) {
      statusIcon = theme.fg("error", "◆");
    } else if (isError) {
      statusIcon = theme.fg("error", "◆");
    } else {
      statusIcon = theme.fg("success", "◆");
    }
  } else {
    statusIcon = isPartial
      ? spinnerGlyph(theme, spinAt)
      : isError
        ? theme.fg("error", "◆")
        : theme.fg("success", "◆");
  }

  const headerText = adapter
    ? adapter.formatCallHeader(args, theme, details, isPartial, expanded, width)
    : formatGenericToolHeader(toolName, args, theme, width);

  const headerLines = headerText.split("\n");
  return headerLines.map((line, i) => {
    const prefix = i === 0 ? `${statusIcon} ` : INDENT;
    return truncateToWidth(prefix + line, width, "…");
  });
}

export function defaultCollapsedRenderer(
  content: string,
  theme: Theme,
  width: number,
): string[] {
  if (!content) return [];
  const previewLines = loadConfig().previewLines;
  const styledOutput = content
    .split("\n")
    .map((line) => theme.fg("toolOutput", line))
    .join("\n");

  const innerWidth = Math.max(1, width - INDENT.length);
  const result = truncateToVisualLines(
    styledOutput,
    previewLines,
    innerWidth,
    0,
  );

  const lines: string[] = [];
  if (result.skippedCount > 0) {
    const hint = theme.fg(
      "muted",
      `${INDENT}... (${result.skippedCount} more lines, ${keyText("app.tools.expand")} to expand)`,
    );
    lines.push(truncateToWidth(hint, width, "…"));
  }
  lines.push(...result.visualLines.map((line) => INDENT + line));
  return lines;
}

export function defaultExpandedRenderer(
  content: string,
  theme: Theme,
  width: number,
): string[] {
  if (!content) return [];
  const lines = formatExpandedToolOutputLines(content, theme, width);
  const hint = theme.fg(
    "muted",
    `${INDENT}${keyText("app.tools.expand")} to collapse`,
  );
  lines.push(truncateToWidth(hint, width, "…"));
  return lines;
}

export function defaultGenericExpandedRenderer(
  output: string,
  theme: Theme,
  width: number,
): string[] {
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
}

export function renderToolCall(
  opts: ToolCallDisplayOpts,
  theme: Theme,
): { render(width: number): string[]; invalidate(): void } {
  const adapter = opts.registry?.get(opts.toolName);

  return {
    render(width: number): string[] {
      const spinAt = Date.now();
      const header = makeHeader(
        opts.toolName,
        opts.args,
        adapter,
        opts.isPartial,
        opts.isError,
        theme,
        width,
        spinAt,
        opts.expanded,
        opts.details,
      );
      const lines = [...header];

      const out = opts.output ?? "";
      const hasTextOutput = Boolean(out);
      const detailsOnlyCollapsed =
        opts.toolName === "subagent" &&
        !opts.expanded &&
        !opts.isPartial &&
        opts.details !== undefined;

      const grepCollapsedPartial =
        opts.toolName === "grep" && !opts.expanded && opts.isPartial;

      const globCollapsedPartial =
        opts.toolName === "glob" && !opts.expanded && opts.isPartial;

      const lsCollapsedPartial =
        opts.toolName === "ls" && !opts.expanded && opts.isPartial;

      const askUserQuestionCollapsed =
        opts.toolName === "ask_user_question" && !opts.expanded && adapter;

      const useAdapter =
        adapter &&
        (opts.expanded ||
          hasTextOutput ||
          askUserQuestionCollapsed ||
          detailsOnlyCollapsed ||
          grepCollapsedPartial ||
          globCollapsedPartial ||
          lsCollapsedPartial ||
          (opts.toolName === "subagent" && !opts.expanded));

      if (useAdapter) {
        const contentLines = opts.expanded
          ? adapter.formatExpandedContent(
              opts.args,
              out,
              theme,
              width,
              opts.details,
            )
          : adapter.formatCollapsedContent(
              opts.args,
              out,
              theme,
              width,
              opts.details,
              opts.isPartial,
              spinAt,
            );
        lines.push(...contentLines);
      } else if (opts.output) {
        const collapsedRenderer =
          opts.renderCollapsed ??
          (adapter
            ? defaultCollapsedRenderer
            : defaultGenericCollapsedRenderer);
        const expandedRenderer =
          opts.renderExpanded ??
          (adapter ? defaultExpandedRenderer : defaultGenericExpandedRenderer);
        const contentLines = opts.expanded
          ? expandedRenderer(opts.output, theme, width)
          : collapsedRenderer(opts.output, theme, width);
        lines.push(...contentLines);
      } else if (!opts.isPartial && !opts.isError) {
        lines.push(INDENT + theme.fg("muted", "done"));
      }

      return lines;
    },
    invalidate() {},
  };
}

export class ToolCallDisplayComponent extends Container {
  private opts: ToolCallDisplayOpts;
  private theme: Theme;

  constructor(opts: ToolCallDisplayOpts, theme: Theme) {
    super();
    this.opts = opts;
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
