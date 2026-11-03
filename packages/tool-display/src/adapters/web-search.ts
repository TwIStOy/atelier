import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines } from "./shared.ts";

interface WebSearchArgs {
  query?: string;
}

function resultCountFromDetails(details: unknown): number | undefined {
  if (details == null || typeof details !== "object") return undefined;
  const c = (details as Record<string, unknown>).resultCount;
  return typeof c === "number" ? c : undefined;
}

function backendFromDetails(details: unknown): string | undefined {
  if (details == null || typeof details !== "object") return undefined;
  const b = (details as Record<string, unknown>).backend;
  return typeof b === "string" && b.length > 0 ? b : undefined;
}

function errorFromDetails(details: unknown): string | undefined {
  if (details == null || typeof details !== "object") return undefined;
  const error = (details as Record<string, unknown>).error;
  return typeof error === "string" && error.length > 0 ? error : undefined;
}

export const webSearchAdapter: ToolDisplayAdapter<WebSearchArgs> = {
  formatCallHeader(args, theme, _details?: unknown) {
    const query = typeof args.query === "string" ? args.query : "";
    const backend = backendFromDetails(_details);
    const tag = backend ? ` ${theme.fg("dim", `(${backend})`)}` : "";
    return `${theme.fg("toolTitle", theme.bold("WebSearch")) + tag} ${theme.fg("accent", `"${query}"`)}`;
  },

  formatCollapsedContent(_args, _output, theme, width, details?: unknown, isPartial?: boolean, _spinAt?: number) {
    if (isPartial) return [theme.fg("muted", "└ searching…")];
    const error = errorFromDetails(details);
    if (error) return [theme.fg("muted", truncateToWidth(`└ ${error}`, width, "…"))];
    const count = resultCountFromDetails(details);
    if (typeof count === "number" && count > 0) {
      return [theme.fg("muted", `└ ${count} result${count !== 1 ? "s" : ""}`)];
    }
    return [theme.fg("muted", "└ no results")];
  },

  formatExpandedContent(_args, output, theme, width, _details?: unknown) {
    return formatExpandedToolOutputLines(output ?? "", theme, width);
  },
};
