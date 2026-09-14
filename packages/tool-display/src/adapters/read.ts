import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { shortenPath, trimTrailingEmpty } from "@htwang-contrib/common";
import { loadConfig } from "../config.ts";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatLineCount, renderContentWithLineNumbers } from "./shared.ts";

interface ReadArgs {
  path?: string;
  file_path?: string;
  offset?: number;
  limit?: number;
}

function formatLineRange(args: ReadArgs, theme: Theme): string {
  if (args?.offset === undefined && args?.limit === undefined) return "";
  const startLine = args.offset ?? 1;
  const endLine = args.limit !== undefined ? String(startLine + args.limit - 1) : "";
  return theme.fg("warning", `:${startLine}${endLine ? `-${endLine}` : ""}`);
}

export const readAdapter: ToolDisplayAdapter<ReadArgs> = {
  formatCallHeader(
    args,
    theme,
    _details?: unknown,
    isPartial?: boolean,
    _expanded?: boolean,
    width?: number,
    output?: string,
  ) {
    const rawPath = args?.file_path ?? args?.path ?? "";
    const path = shortenPath(rawPath);
    const pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
    const verb = isPartial ? "Reading" : "Read";
    const base = `${theme.fg("toolTitle", theme.bold(verb))} ${pathDisplay}${formatLineRange(args, theme)}`;

    if (loadConfig().readStyle !== "single-line") return base;

    if (!output) return base;
    const count = trimTrailingEmpty(output.split("\n")).length;
    if (count === 0) return base;
    const suffix = theme.fg("dim", `· ${count} line${count !== 1 ? "s" : ""}`);
    if (width !== undefined && visibleWidth(base) + 1 + visibleWidth(suffix) > width) return base;
    return `${base} ${suffix}`;
  },

  formatCollapsedContent(_args, output, theme, _width, _details?: unknown, _isPartial?: boolean, _spinAt?: number) {
    if (loadConfig().readStyle === "single-line") return [];
    if (!output) return [];
    return formatLineCount(output, theme);
  },

  formatExpandedContent(args, output, theme, width, _details?: unknown) {
    const rawPath = args?.file_path ?? args?.path ?? "";
    const startLine = args?.offset ?? 1;
    return renderContentWithLineNumbers(output, startLine, rawPath, theme, width);
  },
};
