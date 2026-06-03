import { shortenPath, truncateDisplay } from "@htwang-contrib/common";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines, formatLineCount } from "./shared.ts";

interface BashArgs {
  command?: string;
  description?: string;
  workdir?: string;
}

export const bashAdapter: ToolDisplayAdapter<BashArgs> = {
  formatCallHeader(
    args,
    theme,
    _details?: unknown,
    _isPartial?: boolean,
    _expanded?: boolean,
  ) {
    const cmd = args?.command ?? "";
    const desc = args?.description;
    const cwd = args?.workdir;

    const cmdDisplay = truncateDisplay(cmd, 60);
    const header = desc
      ? theme.fg("toolTitle", theme.bold("Bash")) +
        " " +
        theme.fg("dim", desc) +
        " " +
        theme.fg("muted", `(${cmdDisplay})`)
      : theme.fg("toolTitle", theme.bold("Bash")) +
        " " +
        theme.fg("muted", cmdDisplay);

    if (cwd) {
      return header + " " + theme.fg("dim", `in ${shortenPath(cwd)}`);
    }
    return header;
  },

  formatCollapsedContent(
    _args,
    output,
    theme,
    _width,
    _details?: unknown,
    _isPartial?: boolean,
    _spinAt?: number,
  ) {
    if (!output) return [];
    return formatLineCount(output, theme);
  },

  formatExpandedContent(_args, output, theme, width, _details?: unknown) {
    return formatExpandedToolOutputLines(output ?? "", theme, width);
  },
};
