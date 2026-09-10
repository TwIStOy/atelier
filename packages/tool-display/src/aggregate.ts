import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import {
  RAIL_BULLET_AGGREGATE,
  RAIL_MARK_GLYPH,
  type RailSpec,
  type RailStatus,
  renderRailLines,
  TOOL_RAIL_LAYOUT,
} from "@htwang-contrib/common";
import { spinnerGlyph } from "./format.ts";

export interface AggregateMemberState {
  toolName: string;
  isPartial: boolean;
  isError: boolean;
}

interface AggregatePhraseSpec {
  verb: string;
  singular: string;
  plural: string;
  progressive: string;
}

const AGGREGATE_TOOL_NAMES = new Set(["grep", "glob", "ls", "read"]);

const PHRASE_SPECS: Record<string, AggregatePhraseSpec> = {
  grep: { verb: "Searched", singular: "pattern", plural: "patterns", progressive: "Searching…" },
  glob: { verb: "Matched", singular: "glob", plural: "globs", progressive: "Matching…" },
  ls: { verb: "Listed", singular: "dir", plural: "dirs", progressive: "Listing…" },
  read: { verb: "Read", singular: "file", plural: "files", progressive: "Reading…" },
};

export function isAggregateToolName(toolName: string): boolean {
  return AGGREGATE_TOOL_NAMES.has(toolName);
}

export function aggregateSummary(members: readonly AggregateMemberState[]): string {
  const stats = new Map<string, { spec: AggregatePhraseSpec; count: number; partial: boolean }>();
  for (const member of members) {
    const spec = PHRASE_SPECS[member.toolName];
    if (!spec) continue;
    const entry = stats.get(member.toolName) ?? { spec, count: 0, partial: false };
    entry.count += 1;
    if (member.isPartial) entry.partial = true;
    stats.set(member.toolName, entry);
  }
  const phrases: string[] = [];
  for (const entry of stats.values()) {
    const noun = entry.count === 1 ? entry.spec.singular : entry.spec.plural;
    phrases.push(entry.partial ? entry.spec.progressive : `${entry.spec.verb} ${entry.count} ${noun}`);
  }
  return phrases.join(", ");
}

export function aggregateRailSpec(members: readonly AggregateMemberState[], theme: Theme, spinAt: number): RailSpec {
  let hasError = false;
  let hasPartial = false;
  for (const member of members) {
    if (member.isError) hasError = true;
    if (member.isPartial) hasPartial = true;
  }
  if (hasError) {
    return { mark: "run", bullet: RAIL_BULLET_AGGREGATE, status: "error" };
  }
  if (hasPartial) {
    return { mark: "aggregate", bullet: spinnerGlyph(theme, spinAt), railStatus: "dim" };
  }
  return { mark: "aggregate", bullet: RAIL_BULLET_AGGREGATE, status: "success", railStatus: "dim" };
}

export function renderAggregateLine(
  members: readonly AggregateMemberState[],
  theme: Theme,
  width: number,
  spinAt = Date.now(),
  expanded = false,
): string[] {
  const body = aggregateSummary(members);
  const failed = members.filter((member) => member.isError).length;
  const bodyWithFailed = failed > 0 ? `${body} ${theme.fg("error", `· ${failed} failed`)}` : body;
  const spec = aggregateRailSpec(members, theme, spinAt);
  if (expanded) spec.mark = "run";
  return renderRailLines([bodyWithFailed], spec, theme, width);
}

const SUBROW_BULLET_COLUMN = TOOL_RAIL_LAYOUT.bulletColumn + 3;
const SUBROW_PREFIX_WIDTH = SUBROW_BULLET_COLUMN + 2;

export function aggregateSubrowBodyWidth(width: number): number {
  return Math.max(0, width - SUBROW_PREFIX_WIDTH);
}

export function renderAggregateSubrowLine(
  header: string,
  bullet: string,
  status: RailStatus | undefined,
  theme: Theme,
  width: number,
): string {
  const railGlyph = RAIL_MARK_GLYPH.run;
  const rail = status ? theme.fg(status, railGlyph) : railGlyph;
  const styledBullet = status ? theme.fg(status, bullet) : bullet;
  const lead = " ".repeat(TOOL_RAIL_LAYOUT.railColumn);
  const gap = " ".repeat(SUBROW_BULLET_COLUMN - TOOL_RAIL_LAYOUT.railColumn - 1);
  const line = `${lead}${rail}${gap}${styledBullet} ${header}`;
  return truncateToWidth(line, width, "…");
}
