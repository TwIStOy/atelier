import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines } from "./shared.ts";

interface WebFetchArgs {
  url?: string;
}

function titleFromDetails(details: unknown): string | undefined {
  if (details == null || typeof details !== "object") return undefined;
  const t = (details as Record<string, unknown>).title;
  return typeof t === "string" && t.length > 0 ? t : undefined;
}

function isTruncated(details: unknown): boolean {
  if (details == null || typeof details !== "object") return false;
  const t = (details as Record<string, unknown>).truncation;
  return t != null && typeof t === "object";
}

function backendFromDetails(details: unknown): string | undefined {
  if (details == null || typeof details !== "object") return undefined;
  const b = (details as Record<string, unknown>).backend;
  return typeof b === "string" && b.length > 0 ? b : undefined;
}

export const webFetchAdapter: ToolDisplayAdapter<WebFetchArgs> = {
  formatCallHeader(args, theme, _details?: unknown) {
    const url = typeof args.url === "string" ? args.url : "";
    const backend = backendFromDetails(_details);
    const tag = backend ? " " + theme.fg("dim", `(${backend})`) : "";
    return (
      theme.fg("toolTitle", theme.bold("WebFetch")) +
      tag +
      " " +
      theme.fg("accent", url)
    );
  },

  formatCollapsedContent(
    _args,
    _output,
    theme,
    _width,
    details?: unknown,
    isPartial?: boolean,
    _spinAt?: number,
  ) {
    if (isPartial)
      return [theme.fg("muted", truncateToWidth("└ fetching…", _width))];
    const title = titleFromDetails(details);
    const truncated = isTruncated(details);
    const parts: string[] = ["└"];
    if (title) parts.push(title);
    if (truncated) parts.push("(truncated)");
    if (parts.length === 1) return [];
    return [theme.fg("muted", truncateToWidth(parts.join(" "), _width))];
  },

  formatExpandedContent(_args, output, theme, width, _details?: unknown) {
    return formatExpandedToolOutputLines(output ?? "", theme, width);
  },
};
