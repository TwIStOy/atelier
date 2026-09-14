import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { shortenPath, trimTrailingEmpty } from "@htwang-contrib/common";
import { loadConfig } from "../config.ts";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatLineCount, renderContentWithLineNumbers } from "./shared.ts";

interface WriteArgs {
  path?: string;
  file_path?: string;
  content?: string;
}

function buildLineCountSuffix(args: WriteArgs, theme: Theme): string {
  const count = trimTrailingEmpty((args?.content ?? "").split("\n")).length;
  if (count === 0) return "";
  return theme.fg("success", `+${count}`);
}

export const writeAdapter: ToolDisplayAdapter<WriteArgs> = {
  formatCallHeader(args, theme, _details?: unknown, isPartial?: boolean, _expanded?: boolean, width?: number) {
    const rawPath = args?.file_path ?? args?.path ?? "";
    const path = shortenPath(rawPath);
    const pathDisplay = path ? theme.fg("accent", path) : theme.fg("toolOutput", "...");
    const verb = isPartial ? "Writing" : "Wrote";
    const base = `${theme.fg("toolTitle", theme.bold(verb))} ${pathDisplay}`;

    if (loadConfig().writeStyle !== "single-line") return base;

    const suffix = buildLineCountSuffix(args ?? {}, theme);
    if (!suffix) return base;
    if (width !== undefined && visibleWidth(base) + 1 + visibleWidth(suffix) > width) return base;
    return `${base} ${suffix}`;
  },

  formatCollapsedContent(args, _output, theme, _width, _details?: unknown, _isPartial?: boolean, _spinAt?: number) {
    if (loadConfig().writeStyle === "single-line") return [];
    const content = args?.content ?? "";
    if (!content) return [theme.fg("muted", "└ empty file")];
    return formatLineCount(content, theme);
  },

  formatExpandedContent(args, _output, theme, width, _details?: unknown) {
    const rawPath = args?.file_path ?? args?.path ?? "";
    const content = args?.content ?? "";
    return renderContentWithLineNumbers(content, 1, rawPath, theme, width);
  },
};
