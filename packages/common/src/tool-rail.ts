import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export type RailMark = "aggregate" | "run" | "none";
export type RailStatus = "success" | "error" | "dim";
export type RailBar = string | ((row: number, rows: number) => string);

export const RAIL_BULLET_SINGLE = "◆";
export const RAIL_BULLET_AGGREGATE = "◈";
export const RAIL_SUBROW_INDENT = 3;

export const TOOL_RAIL_LAYOUT = {
  railColumn: 2,
  bulletColumn: 5,
  bodyColumn: 7,
  prefixWidth: 7,
} as const;

export function toolRailBodyWidth(width: number, indent = 0): number {
  return Math.max(0, width - TOOL_RAIL_LAYOUT.prefixWidth - indent);
}

export interface RailSpec {
  mark: RailMark;
  bullet: string;
  status?: RailStatus;
  railStatus?: RailStatus;
  bar?: RailBar;
  indent?: number;
}

export const RAIL_MARK_GLYPH: Record<RailMark, string> = {
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
  const status = spec.railStatus ?? spec.status;
  return status ? theme.fg(status, glyph) : glyph;
}

export function renderRailLines(bodyLines: string[], spec: RailSpec, theme: Theme, width: number): string[] {
  const rows = bodyLines.length;
  const indent = " ".repeat(spec.indent ?? 0);
  return bodyLines.map((body, row) => {
    const rail = railText(spec, theme, row, rows);
    const bullet = row === 0 ? (spec.status ? theme.fg(spec.status, spec.bullet) : spec.bullet) : "";
    const composed = LEAD + padCell(rail, RAIL_CELL_WIDTH) + indent + padCell(bullet, BULLET_CELL_WIDTH) + body;
    const line = body === "" ? composed.replace(/[ \t]+$/, "") : composed;
    return truncateToWidth(line, width, "…");
  });
}

export class ToolRailComponent implements Component {
  private inner: Component;
  private spec: RailSpec | (() => RailSpec);
  private theme: Theme;

  constructor(inner: Component, spec: RailSpec | (() => RailSpec), theme: Theme) {
    this.inner = inner;
    this.spec = spec;
    this.theme = theme;
  }

  render(width: number): string[] {
    const spec = typeof this.spec === "function" ? this.spec() : this.spec;
    return renderRailLines(this.inner.render(toolRailBodyWidth(width, spec.indent)), spec, this.theme, width);
  }

  invalidate(): void {
    this.inner.invalidate();
  }
}

// Cross-extension contract: a component whose rendered output ends with a
// thinking-rail line marks itself with the number of blank lines it already
// emitted after that rail line. Rail-aware siblings below (tool widgets) then
// skip their own leading blank line so the value fully owns the gap.
const RAIL_TAIL_SPACING_KEY = "__railTailSpacing";

export function setRailTailSpacing(component: object, spacing: number): void {
  (component as Record<string, unknown>)[RAIL_TAIL_SPACING_KEY] = spacing;
}

export function clearRailTailSpacing(component: object): void {
  delete (component as Record<string, unknown>)[RAIL_TAIL_SPACING_KEY];
}

export function readRailTailSpacing(component: unknown): number | undefined {
  if (component == null || typeof component !== "object") return undefined;
  const value = (component as Record<string, unknown>)[RAIL_TAIL_SPACING_KEY];
  return typeof value === "number" ? value : undefined;
}

// Cross-extension contract: an assistant message component that qualifies as a
// ThoughtMember (finished, collapsed, no visible body text) marks itself so
// grouping consumers (tool-display's verb-group) can fold across it. The
// marker only advertises eligibility; the consumer claims the member by
// stamping it, and only then does the owner render it at zero lines.
const THOUGHT_MEMBER_KEY = "__thoughtMember";

export function setThoughtMember(component: object, active: boolean): void {
  if (active) {
    (component as Record<string, unknown>)[THOUGHT_MEMBER_KEY] = true;
  } else {
    delete (component as Record<string, unknown>)[THOUGHT_MEMBER_KEY];
  }
}

export function isThoughtMember(component: unknown): boolean {
  if (component == null || typeof component !== "object") return false;
  return (component as Record<string, unknown>)[THOUGHT_MEMBER_KEY] === true;
}

// Written by the grouping consumer (tool-display) when it folds an eligible
// ThoughtMember into a verb-group span. The owner (compact-thinking) reads the
// stamp at render time: claimed members render zero lines; unclaimed ones keep
// their heading row and re-sync the stamp from their own eligibility.
const THOUGHT_MEMBER_CLAIMED_KEY = "__thoughtMemberClaimed";

export function setThoughtMemberClaimed(component: object, claimed: boolean): void {
  if (claimed) {
    (component as Record<string, unknown>)[THOUGHT_MEMBER_CLAIMED_KEY] = true;
  } else {
    delete (component as Record<string, unknown>)[THOUGHT_MEMBER_CLAIMED_KEY];
  }
}

export function isThoughtMemberClaimed(component: unknown): boolean {
  if (component == null || typeof component !== "object") return false;
  return (component as Record<string, unknown>)[THOUGHT_MEMBER_CLAIMED_KEY] === true;
}

const THOUGHT_GROUP_EXPANDED_KEY = "__thoughtGroupExpanded";

export function setThoughtGroupExpanded(component: object, expanded: boolean): void {
  if (expanded) {
    (component as Record<string, unknown>)[THOUGHT_GROUP_EXPANDED_KEY] = true;
  } else {
    delete (component as Record<string, unknown>)[THOUGHT_GROUP_EXPANDED_KEY];
  }
}

export function isThoughtGroupExpanded(component: unknown): boolean {
  if (component == null || typeof component !== "object") return false;
  return (component as Record<string, unknown>)[THOUGHT_GROUP_EXPANDED_KEY] === true;
}

// Cross-extension contract: an assistant message component showing streaming
// or user-expanded thinking (with no text body) marks itself as Transparent
// for grouping consumers: it neither joins a verb-group nor breaks one, and it
// keeps its own rows. Set by the owner (compact-thinking) on every content
// rebuild.
const THOUGHT_TRANSPARENT_KEY = "__thoughtTransparent";

export function setThoughtTransparent(component: object, active: boolean): void {
  if (active) {
    (component as Record<string, unknown>)[THOUGHT_TRANSPARENT_KEY] = true;
  } else {
    delete (component as Record<string, unknown>)[THOUGHT_TRANSPARENT_KEY];
  }
}

export function isThoughtTransparent(component: unknown): boolean {
  if (component == null || typeof component !== "object") return false;
  return (component as Record<string, unknown>)[THOUGHT_TRANSPARENT_KEY] === true;
}
