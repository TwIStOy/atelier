import { shortenPath } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines, formatLineCount } from "./shared.ts";

interface GlobArgs {
  pattern?: string;
  path?: string;
}

function fileCountFromDetails(details: unknown): number | undefined {
  if (details == null || typeof details !== "object") return undefined;
  const c = (details as Record<string, unknown>).count;
  return typeof c === "number" ? c : undefined;
}

export const globAdapter: ToolDisplayAdapter<GlobArgs> = {
  formatCallHeader(args, theme, _details?: unknown, _isPartial?: boolean, _expanded?: boolean) {
    const pattern = typeof args.pattern === "string" ? args.pattern : "";
    const pathRaw = typeof args.path === "string" ? args.path.trim() : "";

    let header = `${theme.fg("toolTitle", theme.bold("Glob"))} ${theme.fg("accent", `"${pattern}"`)}`;
    if (pathRaw) {
      header += ` ${theme.fg("toolOutput", `in ${shortenPath(pathRaw)}`)}`;
    }
    return header;
  },

  formatCollapsedContent(_args, output, theme, _width, details?: unknown, isPartial?: boolean, _spinAt?: number) {
    if (isPartial) return [];
    const count = fileCountFromDetails(details);
    if (typeof count === "number") {
      const msg = count === 0 ? "no files" : `${count} file${count !== 1 ? "s" : ""}`;
      return [theme.fg("muted", `└ ${msg}`)];
    }
    if (!output) return [];
    return formatLineCount(output, theme);
  },

  formatExpandedContent(_args, output, theme, width, _details?: unknown) {
    return formatExpandedToolOutputLines(output ?? "", theme, width);
  },
};
