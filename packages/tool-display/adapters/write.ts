import { shortenPath } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatLineCount, renderContentWithLineNumbers } from "./shared.ts";

interface WriteArgs {
  path?: string;
  file_path?: string;
  content?: string;
}

export const writeAdapter: ToolDisplayAdapter<WriteArgs> = {
  formatCallHeader(
    args,
    theme,
    _details?: unknown,
    _isPartial?: boolean,
    _expanded?: boolean,
  ) {
    const rawPath = args?.file_path ?? args?.path ?? "";
    const path = shortenPath(rawPath);
    const pathDisplay = path
      ? theme.fg("accent", path)
      : theme.fg("toolOutput", "...");
    return theme.fg("toolTitle", theme.bold("Write")) + " " + pathDisplay;
  },

  formatCollapsedContent(
    args,
    _output,
    theme,
    _width,
    _details?: unknown,
    _isPartial?: boolean,
    _spinAt?: number,
  ) {
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
