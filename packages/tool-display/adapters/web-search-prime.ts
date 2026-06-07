import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines } from "./shared.ts";

interface WebSearchPrimeArgs {
  query?: string;
}

function resultCountFromDetails(details: unknown): number | undefined {
  if (details == null || typeof details !== "object") return undefined;
  const c = (details as Record<string, unknown>).resultCount;
  return typeof c === "number" ? c : undefined;
}

export const webSearchPrimeAdapter: ToolDisplayAdapter<WebSearchPrimeArgs> = {
  formatCallHeader(args, theme) {
    const query = typeof args.query === "string" ? args.query : "";
    return (
      theme.fg("toolTitle", theme.bold("Web Search Prime")) +
      " " +
      theme.fg("accent", `"${query}"`)
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
    if (isPartial) return [theme.fg("muted", "└ searching…")];
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
