import {
  keyText,
  Theme,
  truncateToVisualLines,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { ContentRenderer, ToolDisplayAdapter } from "./types.ts";

export type { ContentRenderer, ToolDisplayAdapter };

const PREVIEW_LINES = 3;

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
      const display = val.length > 80 ? val.slice(0, 77) + "…" : val;
      return `${k}: ${display}`;
    })
    .join(", ");
}

function makeHeader(
  toolName: string,
  args: Record<string, unknown>,
  adapter: ToolDisplayAdapter | undefined,
  isPartial: boolean,
  isError: boolean,
  theme: Theme,
  width: number,
): string {
  const statusIcon = isPartial
    ? theme.fg("muted", "○")
    : isError
      ? theme.fg("error", "✗")
      : theme.fg("success", "✓");

  const headerText = adapter
    ? adapter.formatCallHeader(args, theme)
    : `${theme.fg("toolTitle", theme.bold(toolName))} ${theme.fg("dim", `(${formatToolArgs(args)})`)}`;

  const header = `${statusIcon} ${headerText}`;
  return truncateToWidth(header, width, "…");
}

const INDENT = "    ";

export function defaultCollapsedRenderer(
  content: string,
  theme: Theme,
  width: number,
): string[] {
  if (!content) return [];
  const styledOutput = content
    .split("\n")
    .map((line) => theme.fg("toolOutput", line))
    .join("\n");

  const innerWidth = Math.max(1, width - INDENT.length);
  const result = truncateToVisualLines(
    styledOutput,
    PREVIEW_LINES,
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
  const lines = content
    .split("\n")
    .map((line) => INDENT + theme.fg("toolOutput", line));
  const hint = theme.fg(
    "muted",
    `${INDENT}${keyText("app.tools.expand")} to collapse`,
  );
  lines.push(truncateToWidth(hint, width, "…"));
  return lines;
}

export interface ToolCallDisplayOpts {
  toolName: string;
  args: Record<string, unknown>;
  output?: string;
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
      const header = makeHeader(
        opts.toolName,
        opts.args,
        adapter,
        opts.isPartial,
        opts.isError,
        theme,
        width,
      );
      const lines = [header];

      if (opts.output) {
        let contentLines: string[];
        if (adapter) {
          contentLines = opts.expanded
            ? adapter.formatExpandedContent(
                opts.args,
                opts.output,
                theme,
                width,
              )
            : adapter.formatCollapsedContent(
                opts.args,
                opts.output,
                theme,
                width,
              );
        } else {
          const collapsedRenderer =
            opts.renderCollapsed ?? defaultCollapsedRenderer;
          const expandedRenderer =
            opts.renderExpanded ?? defaultExpandedRenderer;
          contentLines = opts.expanded
            ? expandedRenderer(opts.output, theme, width)
            : collapsedRenderer(opts.output, theme, width);
        }
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
