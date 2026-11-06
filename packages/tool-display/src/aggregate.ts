import type { Theme } from "@earendil-works/pi-coding-agent";
import { aggregateRuleFor } from "@htwang-contrib/common/aggregate-rules";
import {
  RAIL_BULLET_AGGREGATE,
  RAIL_SUBROW_INDENT,
  type RailSpec,
  type RailStatus,
  renderRailLines,
  toolRailBodyWidth,
} from "@htwang-contrib/common/tool-rail";
import { spinnerGlyph } from "./format.ts";

export interface AggregateMemberState {
  toolName: string;
  isPartial: boolean;
  isError: boolean;
}

/**
 * Verb-group header body: per-kind count phrases bucketed in first-appearance
 * order, joined with ", ". A kind with any partial member switches to its
 * progressive phrase. Members without an Aggregate Rule are skipped.
 */
export function aggregateSummary(members: readonly AggregateMemberState[]): string {
  const stats = new Map<string, { count: number; partial: boolean }>();
  for (const member of members) {
    if (aggregateRuleFor(member.toolName) === undefined) continue;
    const entry = stats.get(member.toolName) ?? { count: 0, partial: false };
    entry.count += 1;
    if (member.isPartial) entry.partial = true;
    stats.set(member.toolName, entry);
  }
  const phrases: string[] = [];
  for (const [toolName, entry] of stats) {
    const rule = aggregateRuleFor(toolName);
    if (!rule) continue;
    const noun = entry.count === 1 ? rule.singular : rule.plural;
    phrases.push(entry.partial ? rule.progressive : `${rule.verb} ${entry.count} ${noun}`);
  }
  return phrases.join(", ");
}

const EDIT_BUCKET_TOOL_NAMES = new Set(["edit", "write", "apply_patch"]);

/**
 * Truncation header body for the hidden (older) participants of a dense run.
 * Uniform runs phrase as `Ran N commands` (bash) or `Edited N files`
 * (edit/write/apply_patch). When the verb-group is off, rule-registered names
 * keep their Aggregate Rule phrasing. Anything else falls back to `N more`.
 */
export function truncationSummary(hidden: readonly AggregateMemberState[], groupToolVerbs: boolean): string {
  const total = hidden.length;
  if (total === 0) return "";
  if (hidden.every((member) => member.toolName === "bash")) {
    return `Ran ${total} command${total === 1 ? "" : "s"}`;
  }
  if (hidden.every((member) => EDIT_BUCKET_TOOL_NAMES.has(member.toolName))) {
    return `Edited ${total} file${total === 1 ? "" : "s"}`;
  }
  if (!groupToolVerbs && hidden.every((member) => aggregateRuleFor(member.toolName) !== undefined)) {
    return aggregateSummary(hidden);
  }
  return `${total} more`;
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

function renderHeaderLine(
  body: string,
  members: readonly AggregateMemberState[],
  theme: Theme,
  width: number,
  spinAt: number,
  expanded = false,
): string[] {
  let text = body;
  const failed = members.filter((member) => member.isError).length;
  if (failed > 0) {
    text += ` ${theme.fg("error", `· ${failed} failed`)}`;
  }
  const spec = aggregateRailSpec(members, theme, spinAt);
  if (expanded) spec.mark = "run";
  return renderRailLines([text], spec, theme, width);
}

export function renderAggregateLine(
  members: readonly AggregateMemberState[],
  theme: Theme,
  width: number,
  spinAt = Date.now(),
  expanded = false,
): string[] {
  return renderHeaderLine(aggregateSummary(members), members, theme, width, spinAt, expanded);
}

export function renderTruncationLine(
  hidden: readonly AggregateMemberState[],
  groupToolVerbs: boolean,
  theme: Theme,
  width: number,
  spinAt = Date.now(),
): string[] {
  return renderHeaderLine(truncationSummary(hidden, groupToolVerbs), hidden, theme, width, spinAt);
}

export function aggregateSubrowBodyWidth(width: number): number {
  return toolRailBodyWidth(width, RAIL_SUBROW_INDENT);
}

export function renderAggregateSubrowLine(
  header: string,
  bullet: string,
  status: RailStatus | undefined,
  theme: Theme,
  width: number,
): string {
  return renderRailLines([header], { mark: "run", bullet, status, indent: RAIL_SUBROW_INDENT }, theme, width)[0] ?? "";
}
