import type { Theme } from "@earendil-works/pi-coding-agent";
import { shortenPath } from "@htwang-contrib/common";
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
  formatCallHeader(args, theme, _details?: unknown, _isPartial?: boolean, _expanded?: boolean) {
    const rawPath = args?.file_path ?? args?.path ?? "";
    const path = shortenPath(rawPath);
    const pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
    return `${theme.fg("toolTitle", theme.bold("Read"))} ${pathDisplay}${formatLineRange(args, theme)}`;
  },

  formatCollapsedContent(_args, output, theme, _width, _details?: unknown, _isPartial?: boolean, _spinAt?: number) {
    if (!output) return [];
    return formatLineCount(output, theme);
  },

  formatExpandedContent(args, output, theme, width, _details?: unknown) {
    const rawPath = args?.file_path ?? args?.path ?? "";
    const startLine = args?.offset ?? 1;
    return renderContentWithLineNumbers(output, startLine, rawPath, theme, width);
  },
};
