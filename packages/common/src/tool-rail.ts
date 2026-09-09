import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type RailMark = "aggregate" | "run" | "none";
export type RailStatus = "success" | "error" | "dim";
export type RailBar = string | ((row: number, rows: number) => string);

export const RAIL_BULLET_SINGLE = "◆";
export const RAIL_BULLET_AGGREGATE = "◈";

export const TOOL_RAIL_LAYOUT = {
  railColumn: 2,
  bulletColumn: 5,
  bodyColumn: 7,
  prefixWidth: 7,
} as const;

export function toolRailBodyWidth(width: number): number {
  return Math.max(0, width - TOOL_RAIL_LAYOUT.prefixWidth);
}

export interface RailSpec {
  mark: RailMark;
  bullet: string;
  status?: RailStatus;
  bar?: RailBar;
}

const RAIL_MARK_GLYPH: Record<RailMark, string> = {
  aggregate: "❙",
  run: "┃",
  none: "",
};

const LEAD = " ".repeat(TOOL_RAIL_LAYOUT.railColumn);
const RAIL_CELL_WIDTH = TOOL_RAIL_LAYOUT.bulletColumn - TOOL_RAIL_LAYOUT.railColumn;
const BULLET_CELL_WIDTH = TOOL_RAIL_LAYOUT.bodyColumn - TOOL_RAIL_LAYOUT.bulletColumn;

function padCell(text: string, cellWidth: number): string {
  const clipped = visibleWidth(text) > cellWidth ? truncateToWidth(text, cellWidth, "") : text;
  return clipped + " ".repeat(Math.max(0, cellWidth - visibleWidth(clipped)));
}

function railText(spec: RailSpec, theme: Theme, row: number, rows: number): string {
  if (spec.bar !== undefined) return typeof spec.bar === "function" ? spec.bar(row, rows) : spec.bar;
  const glyph = RAIL_MARK_GLYPH[spec.mark];
  if (glyph === "") return "";
  return spec.status ? theme.fg(spec.status, glyph) : glyph;
}

export function renderRailLines(bodyLines: string[], spec: RailSpec, theme: Theme, width: number): string[] {
  const rows = bodyLines.length;
  return bodyLines.map((body, row) => {
    const rail = railText(spec, theme, row, rows);
    const bullet = row === 0 ? (spec.status ? theme.fg(spec.status, spec.bullet) : spec.bullet) : "";
    const composed = LEAD + padCell(rail, RAIL_CELL_WIDTH) + padCell(bullet, BULLET_CELL_WIDTH) + body;
    const line = body === "" ? composed.replace(/[ \t]+$/, "") : composed;
    return truncateToWidth(line, width, "…");
  });
}

export class ToolRailComponent implements Component {
  private inner: Component;
  private spec: RailSpec;
  private theme: Theme;

  constructor(inner: Component, spec: RailSpec, theme: Theme) {
    this.inner = inner;
    this.spec = spec;
    this.theme = theme;
  }

  render(width: number): string[] {
    return renderRailLines(this.inner.render(toolRailBodyWidth(width)), this.spec, this.theme, width);
  }

  invalidate(): void {
    this.inner.invalidate();
  }
}
