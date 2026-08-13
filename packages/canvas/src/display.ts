import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

interface CanvasPublishArgs {
  name?: string;
  html?: string;
}

const INDENT = "    ";

function firstHttpUrl(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  }
  return undefined;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export const canvasPublishAdapter = {
  formatCallHeader(args: CanvasPublishArgs, theme: Theme): string {
    const title = theme.fg("toolTitle", theme.bold("Canvas Publish"));
    const name = args?.name;
    return name ? `${title} ${theme.fg("accent", name)}` : title;
  },

  formatCollapsedContent(args: CanvasPublishArgs, output: string, theme: Theme, width: number): string[] {
    const html = args?.html ?? "";
    const url = firstHttpUrl(output);
    const parts: string[] = [];
    if (html) parts.push(formatBytes(html.length));
    if (url) parts.push(url);
    if (parts.length === 0) return [];
    return [theme.fg("muted", truncateToWidth(`└ ${parts.join(" · ")}`, width, "…"))];
  },

  formatExpandedContent(args: CanvasPublishArgs, _output: string, theme: Theme, width: number): string[] {
    const html = args?.html ?? "";
    if (!html) return [theme.fg("muted", `${INDENT}empty`)];
    const inner = Math.max(1, width - INDENT.length);
    return html.split("\n").map((line) => INDENT + truncateToWidth(theme.fg("toolOutput", line), inner, "…"));
  },
};
