import { shortenPath } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";
import { outputContentMethods } from "./shared.ts";

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

  ...outputContentMethods((details) => {
    const matches = matchCountFromDetails(details);
    if (typeof matches !== "number") return undefined;
    return `${matches} match${matches !== 1 ? "es" : ""}`;
  }),
};
