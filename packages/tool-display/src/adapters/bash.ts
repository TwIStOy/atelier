import { visibleWidth } from "@earendil-works/pi-tui";
import { shortenPath, truncateDisplay } from "@htwang-contrib/common";
import { loadConfig } from "../config.ts";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines, formatLineCount } from "./shared.ts";

interface BashArgs {
  command?: string;
  description?: string;
  workdir?: string;
}

const HEADER_PREFIX_WIDTH = "◆ Bash ".length;
const CMD_DELIM_WIDTH = 2;
const CWD_PREFIX_WIDTH = " in ".length;

function bashCommandDisplayLength(desc: string, cwd: string, width: number | undefined): number {
  const floor = loadConfig().bashCommandDisplayLength;
  if (width === undefined) return floor;

  const overhead =
    HEADER_PREFIX_WIDTH +
    (desc ? visibleWidth(desc) + 1 : 0) +
    CMD_DELIM_WIDTH +
    (cwd ? CWD_PREFIX_WIDTH + visibleWidth(shortenPath(cwd)) : 0);
  return Math.max(floor, width - overhead);
}

export const bashAdapter: ToolDisplayAdapter<BashArgs> = {
  formatCallHeader(args, theme, _details?: unknown, _isPartial?: boolean, _expanded?: boolean, width?: number) {
    const cmd = args?.command ?? "";
    const desc = args?.description;
    const cwd = args?.workdir;

    const cmdDisplay = truncateDisplay(cmd, bashCommandDisplayLength(desc ?? "", cwd ?? "", width));
    const header = desc
      ? theme.fg("toolTitle", theme.bold("Bash")) +
        " " +
        theme.fg("dim", desc) +
        " " +
        theme.fg("muted", `(${cmdDisplay})`)
      : theme.fg("toolTitle", theme.bold("Bash")) + " " + theme.fg("muted", cmdDisplay);

    if (cwd) {
      return header + " " + theme.fg("dim", `in ${shortenPath(cwd)}`);
    }
    return header;
  },

  formatCollapsedContent(_args, output, theme, _width, _details?: unknown, _isPartial?: boolean, _spinAt?: number) {
    if (!output) return [];
    return formatLineCount(output, theme);
  },

  formatExpandedContent(_args, output, theme, width, _details?: unknown) {
    return formatExpandedToolOutputLines(output ?? "", theme, width);
  },
};
