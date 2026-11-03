import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ToolDisplayAdapter } from "../types.ts";
import { backendTag, formatExpandedToolOutputLines, numberField, stringField } from "./shared.ts";

interface WebSearchArgs {
  query?: string;
}

export const webSearchAdapter: ToolDisplayAdapter<WebSearchArgs> = {
  formatCallHeader(args, theme, _details?: unknown) {
    const query = typeof args.query === "string" ? args.query : "";
    const tag = backendTag(theme, _details);
    return `${theme.fg("toolTitle", theme.bold("WebSearch")) + tag} ${theme.fg("accent", `"${query}"`)}`;
  },

  formatCollapsedContent(_args, _output, theme, width, details?: unknown, isPartial?: boolean, _spinAt?: number) {
    if (isPartial) return [theme.fg("muted", "└ searching…")];
    const error = stringField(details, "error");
    if (error) return [theme.fg("muted", truncateToWidth(`└ ${error}`, width, "…"))];
    const count = numberField(details, "resultCount");
    if (typeof count === "number" && count > 0) {
      return [theme.fg("muted", `└ ${count} result${count !== 1 ? "s" : ""}`)];
    }
    return [theme.fg("muted", "└ no results")];
  },

  formatExpandedContent(_args, output, theme, width, _details?: unknown) {
    return formatExpandedToolOutputLines(output ?? "", theme, width);
  },
};
