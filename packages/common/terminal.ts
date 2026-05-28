import Table from "cli-table3";

const RESET_FOREGROUND = "\x1b[39m";

export function resetForegroundBeforeText(text: string): string {
  return `${RESET_FOREGROUND}${text}`;
}

export function terminalWidth(): number {
  return process.stdout.columns && process.stdout.columns > 0
    ? process.stdout.columns
    : 80;
}

export function fitColWidths(
  colCount: number,
  ...minWidths: number[]
): number[] {
  const totalMin = minWidths.reduce((a, b) => a + b, 0);
  const borderOverhead = colCount + 1 + 2 * colCount;
  const available = terminalWidth() - borderOverhead;
  if (available >= totalMin) return minWidths;
  const scale = available / totalMin;
  return minWidths.map((w) => Math.max(Math.floor(w * scale), 5));
}

const TABLE_OPTS = {
  chars: {
    top: "─",
    "top-mid": "┬",
    "top-left": "┌",
    "top-right": "┐",
    bottom: "─",
    "bottom-mid": "┴",
    "bottom-left": "└",
    "bottom-right": "┘",
    left: "│",
    "left-mid": "├",
    mid: "─",
    "mid-mid": "┼",
    right: "│",
    "right-mid": "┤",
    middle: "│",
  },
  style: {
    "padding-left": 1,
    "padding-right": 1,
    compact: true,
    head: ["hex(#FFA500)"],
    border: [],
  },
  wordWrap: true,
};

export function makeTable(head: string[], colWidths?: number[]): Table.Table {
  return new Table({ ...TABLE_OPTS, head, colWidths });
}
