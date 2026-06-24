import Table from "cli-table3";

const RESET_FOREGROUND = "\x1b[39m";

export function resetForegroundBeforeText(text: string): string {
  return `${RESET_FOREGROUND}${text}`;
}

export function terminalWidth(): number {
  return process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80;
}

export function fitColWidths(colCount: number, ...minWidths: number[]): number[] {
  const totalMin = minWidths.reduce((a, b) => a + b, 0);
  const borderOverhead = colCount + 1 + 2 * colCount;
  const available = terminalWidth() - borderOverhead;
  if (available >= totalMin) return minWidths;
  const scale = available / totalMin;
  return minWidths.map((w) => Math.max(Math.floor(w * scale), 5));
}

const ANSI_RGB_RE = /\x1b\[(?:38|48);2;(\d+);(\d+);(\d+)m/;

export function extractAnsiRgb(ansi: string): string | null {
  const m = ANSI_RGB_RE.exec(ansi);
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map((n) => parseInt(n, 10).toString(16).padStart(2, "0")).join("")}`;
}

export function mixAnsiRgb(a: string, ratioA: number, b: string, ratioB: number): string | null {
  const ra = ANSI_RGB_RE.exec(a);
  const rb = ANSI_RGB_RE.exec(b);
  if (!ra || !rb) return null;
  const total = ratioA + ratioB;
  const mix = (i: number) => Math.round((parseInt(ra[i + 1], 10) * ratioA + parseInt(rb[i + 1], 10) * ratioB) / total);
  return `#${[mix(0), mix(1), mix(2)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
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
