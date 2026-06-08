import type { Theme } from "@earendil-works/pi-coding-agent";
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

export const webFetchAdapter: ToolDisplayAdapter<WebFetchArgs> = {
  formatCallHeader(args, theme) {
    const url = typeof args.url === "string" ? args.url : "";
    return (
      theme.fg("toolTitle", theme.bold("Web Fetch")) +
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
    if (isPartial) return [theme.fg("muted", "└ fetching…")];
    const title = titleFromDetails(details);
    const truncated = isTruncated(details);
    const parts: string[] = ["└"];
    if (title) parts.push(title);
    if (truncated) parts.push("(truncated)");
    if (parts.length === 1) return [];
    return [theme.fg("muted", parts.join(" "))];
  },

  formatExpandedContent(_args, output, theme, width, _details?: unknown) {
    return formatExpandedToolOutputLines(output ?? "", theme, width);
  },
};
