import type { Theme } from "@earendil-works/pi-coding-agent";
import { shortenPath } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";
import { INDENT, formatLineCount } from "./shared.ts";

interface LsArgs {
  path?: string;
  limit?: number;
}

function entryCountFromDetails(details: unknown): number | undefined {
  if (details == null || typeof details !== "object") return undefined;
  const n = (details as Record<string, unknown>).entries;
  return typeof n === "number" ? n : undefined;
}

export const lsAdapter: ToolDisplayAdapter<LsArgs> = {
  formatCallHeader(
    args,
    theme,
    _details?: unknown,
    _isPartial?: boolean,
    _expanded?: boolean,
  ) {
    const rawPath = typeof args.path === "string" ? args.path.trim() : "";
    const displayPath = rawPath ? shortenPath(rawPath) : ".";
    const lim = args.limit;
    let header =
      theme.fg("toolTitle", theme.bold("Ls")) +
      " " +
      theme.fg("accent", displayPath);
    if (typeof lim === "number" && Number.isFinite(lim)) {
      header += theme.fg("toolOutput", ` (limit ${Math.floor(lim)})`);
    }
    return header;
  },

  formatCollapsedContent(
    _args,
    output,
    theme,
    _width,
    details?: unknown,
    isPartial?: boolean,
    _spinAt?: number,
  ) {
    if (isPartial) return [];
    const n = entryCountFromDetails(details);
    if (typeof n === "number") {
      const msg =
        n === 0 ? "empty directory" : `${n} ${n === 1 ? "entry" : "entries"}`;
      return [theme.fg("muted", `└ ${msg}`)];
    }
    if (!output) return [];
    return formatLineCount(output, theme);
  },

  formatExpandedContent(_args, output, theme, _width, _details?: unknown) {
    if (!output) return [];
    return output
      .split("\n")
      .map((line) => INDENT + theme.fg("toolOutput", line));
  },
};
