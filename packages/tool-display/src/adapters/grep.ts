import { shortenPath } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines, formatLineCount } from "./shared.ts";

interface GrepArgs {
  pattern?: string;
  path?: string;
  include?: string;
  glob?: string;
}

function matchCountFromDetails(details: unknown): number | undefined {
  if (details == null || typeof details !== "object") return undefined;
  const m = (details as Record<string, unknown>).matches;
  return typeof m === "number" ? m : undefined;
}

export const grepAdapter: ToolDisplayAdapter<GrepArgs> = {
  formatCallHeader(args, theme, _details?: unknown, _isPartial?: boolean, _expanded?: boolean) {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    const pathRaw = typeof args.path === "string" ? args.path.trim() : "";
    const filterRaw =
      (typeof args.include === "string" ? args.include.trim() : "") ||
      (typeof args.glob === "string" ? args.glob.trim() : "");

    let header = `${theme.fg("toolTitle", theme.bold("Grep"))} ${theme.fg("accent", `/${pattern}/`)}`;
    if (pathRaw) {
      header += ` ${theme.fg("toolOutput", `in ${shortenPath(pathRaw)}`)}`;
    }
    if (filterRaw) {
      header += ` ${theme.fg("dim", `(${filterRaw})`)}`;
    }
    return header;
  },

  formatCollapsedContent(_args, output, theme, _width, details?: unknown, isPartial?: boolean, _spinAt?: number) {
    if (isPartial) return [];
    const matches = matchCountFromDetails(details);
    if (typeof matches === "number") {
      const msg = `${matches} match${matches !== 1 ? "es" : ""}`;
      return [theme.fg("muted", `└ ${msg}`)];
    }
    if (!output) return [];
    return formatLineCount(output, theme);
  },

  formatExpandedContent(_args, output, theme, width, _details?: unknown) {
    return formatExpandedToolOutputLines(output ?? "", theme, width);
  },
};
