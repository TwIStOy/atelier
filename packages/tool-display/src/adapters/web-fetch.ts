import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ToolDisplayAdapter } from "../types.ts";
import { backendTag, formatExpandedToolOutputLines, stringField } from "./shared.ts";

interface WebFetchArgs {
  url?: string;
}

function isTruncated(details: unknown): boolean {
  if (details == null || typeof details !== "object") return false;
  const t = (details as Record<string, unknown>).truncation;
  return t != null && typeof t === "object";
}

function collapsedParts(title: string | undefined, truncated: boolean): string[] {
  const parts: string[] = ["└"];
  if (title) parts.push(title);
  if (truncated) parts.push("(truncated)");
  return parts;
}

export const webFetchAdapter: ToolDisplayAdapter<WebFetchArgs> = {
  formatCallHeader(args, theme, _details?: unknown) {
    const url = typeof args.url === "string" ? args.url : "";
    const tag = backendTag(theme, _details);
    return `${theme.fg("toolTitle", theme.bold("WebFetch")) + tag} ${theme.fg("accent", url)}`;
  },

  formatCollapsedContent(_args, _output, theme, _width, details?: unknown, isPartial?: boolean, _spinAt?: number) {
    if (isPartial) return [theme.fg("muted", truncateToWidth("└ fetching…", _width))];
    const parts = collapsedParts(stringField(details, "title"), isTruncated(details));
    if (parts.length === 1) return [];
    return [theme.fg("muted", truncateToWidth(parts.join(" "), _width))];
  },

  formatExpandedContent(_args, output, theme, width, _details?: unknown) {
    return formatExpandedToolOutputLines(output ?? "", theme, width);
  },
};
