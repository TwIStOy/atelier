import { shortenPath } from "@htwang-contrib/common/format";
import type { ToolDisplayAdapter } from "../types.ts";
import { outputContentMethods } from "./shared.ts";

interface LsArgs {
  path?: string;
  limit?: number;
}

function entryCountFromDetails(details: unknown): number | undefined {
  if (details == null || typeof details !== "object") return undefined;
  const n = (details as Record<string, unknown>).entries;
  return typeof n === "number" ? n : undefined;
}

function limitSuffix(lim: number | undefined): string {
  if (typeof lim !== "number" || !Number.isFinite(lim)) return "";
  return ` (limit ${Math.floor(lim)})`;
}

export const lsAdapter: ToolDisplayAdapter<LsArgs> = {
  formatCallHeader(args, theme, _details?: unknown, _isPartial?: boolean, _expanded?: boolean) {
    const rawPath = typeof args.path === "string" ? args.path.trim() : "";
    const displayPath = rawPath ? shortenPath(rawPath) : ".";
    const suffix = limitSuffix(args.limit);
    let header = `${theme.fg("toolTitle", theme.bold("Ls"))} ${theme.fg("accent", displayPath)}`;
    if (suffix) header += theme.fg("toolOutput", suffix);
    return header;
  },

  ...outputContentMethods((details) => {
    const n = entryCountFromDetails(details);
    if (typeof n !== "number") return undefined;
    return n === 0 ? "empty directory" : `${n} ${n === 1 ? "entry" : "entries"}`;
  }),
};
