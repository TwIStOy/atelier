import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines } from "./shared.ts";

interface WebReadPrimeArgs {
  url?: string;
}

function lineCountFromDetails(details: unknown): number | undefined {
  if (details == null || typeof details !== "object") return undefined;
  const c = (details as Record<string, unknown>).lineCount;
  return typeof c === "number" ? c : undefined;
}

export const webReadPrimeAdapter: ToolDisplayAdapter<WebReadPrimeArgs> = {
  formatCallHeader(args, theme) {
    const url = typeof args.url === "string" ? args.url : "";
    return (
      theme.fg("toolTitle", theme.bold("Web Read Prime")) +
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
    if (isPartial) return [theme.fg("muted", "└ reading…")];
    const count = lineCountFromDetails(details);
    if (typeof count === "number") {
      return [theme.fg("muted", `└ ${count} line${count !== 1 ? "s" : ""}`)];
    }
    return [];
  },

  formatExpandedContent(_args, output, theme, width, _details?: unknown) {
    return formatExpandedToolOutputLines(output ?? "", theme, width);
  },
};
