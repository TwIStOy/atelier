import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { aggregateRuleFor } from "@htwang-contrib/common/aggregate-rules";
import { componentRendersLines, findComponentContextInFrame } from "@htwang-contrib/common/component-tree";
import { getConfigFileVersion } from "@htwang-contrib/common/config";
import { currentFrameEpoch } from "@htwang-contrib/common/frame-epoch";
import {
  isThoughtMember,
  isThoughtMemberClaimed,
  isThoughtTransparent,
  setThoughtGroupExpanded,
  setThoughtMemberClaimed,
} from "@htwang-contrib/common/tool-rail";
import { loadConfig } from "./config.ts";
import type { ToolExecutionPatchThis } from "./types.ts";

export type GroupRole =
  | { role: "verb-leader"; members: ToolExecutionPatchThis[]; groupExpanded: boolean }
  | { role: "truncation-leader"; hidden: ToolExecutionPatchThis[] }
  | { role: "claimed"; groupExpanded: boolean };

const aggregateGroupState = new WeakMap<object, { expanded: boolean }>();

export function isGroupExpanded(tool: object): boolean {
  return aggregateGroupState.get(tool)?.expanded === true;
}

export function setGroupExpanded(tool: object, expanded: boolean): void {
  if (expanded) aggregateGroupState.set(tool, { expanded: true });
  else aggregateGroupState.delete(tool);
}

let roleMutationVersion = 0;

// Role-relevant changes: any tool state update, aggregate-group toggles,
// aggregate-rule registrations. Only invalidates the frame-scoped role memo.
export function bumpRoleMutation(): void {
  roleMutationVersion++;
}

function asToolExecution(component: unknown): ToolExecutionPatchThis | undefined {
  return component instanceof ToolExecutionComponent ? (component as unknown as ToolExecutionPatchThis) : undefined;
}

// Grouping is computed once per hard-break-bounded Region per frame and shared
// by every component in the Region (memoizedRegionRoles). The scan covers the
// Region around the component: verb-group claims rule-registered tools and
// eligible ThoughtMembers first, then the truncation layer folds what remains
// of over-long dense tool runs.
type RegionSpan = { leader: number; members: number[]; thoughts: number[]; groupExpanded: boolean };

function computeRegionRoles(siblings: unknown[], lo: number, hi: number): Map<number, GroupRole> {
  const { groupMaxVisible } = loadConfig();
  const verbClasses = classifyRegionSiblings(siblings, lo, hi);
  const spans = collectVerbSpans(siblings, lo, hi, verbClasses);
  // A group of one carries no aggregate information (it would just hide the
  // path behind "Read 1 file"), so singleton spans render as ordinary tools.
  // They neither claim their adjacent thoughts nor count as span-covered for
  // the truncation layer.
  const groupSpans = spans.filter((span) => span.members.length >= 2);
  markRegionThoughts(siblings, lo, hi, groupSpans);
  const roles = new Map<number, GroupRole>();
  const spanCovered = assignGroupRoles(roles, siblings, groupSpans);
  computeTruncationRoles(siblings, lo, hi, spanCovered, groupMaxVisible, roles);
  return roles;
}

function classifyRegionSiblings(siblings: unknown[], lo: number, hi: number): Map<number, string> {
  const { groupToolVerbs } = loadConfig();
  const verbClasses = new Map<number, string>();
  for (let i = lo; i <= hi; i++) {
    verbClasses.set(i, classifyRegionSibling(siblings[i], groupToolVerbs));
  }
  return verbClasses;
}

function classifyRegionSibling(sibling: unknown, groupToolVerbs: boolean): string {
  const tool = asToolExecution(sibling);
  if (tool) return classifyToolSibling(tool, groupToolVerbs);
  if (isThoughtMember(sibling)) return "thought";
  return "transparent";
}

function classifyToolSibling(tool: ToolExecutionPatchThis, groupToolVerbs: boolean): string {
  if (tool.hideComponent) return "transparent";
  if (tool.expanded) {
    // A leader expanded through its own subrow keeps heading its expanded
    // group; any other expanded tool is Transparent to the scan.
    const headsExpandedGroup = groupToolVerbs && aggregateRuleFor(tool.toolName) !== undefined && isGroupExpanded(tool);
    return headsExpandedGroup ? "member" : "transparent";
  }
  if (groupToolVerbs && aggregateRuleFor(tool.toolName) !== undefined) return "member";
  return "break";
}

function collectVerbSpans(siblings: unknown[], lo: number, hi: number, verbClasses: Map<number, string>): RegionSpan[] {
  const spans: RegionSpan[] = [];
  let i = lo;
  while (i <= hi) {
    if (verbClasses.get(i) !== "member") {
      i++;
      continue;
    }
    const collected = collectSpanFrom(siblings, i, hi, verbClasses);
    spans.push(collected.span);
    i = collected.next;
  }
  return spans;
}

function collectSpanFrom(
  siblings: unknown[],
  leader: number,
  hi: number,
  verbClasses: Map<number, string>,
): { span: RegionSpan; next: number } {
  const leaderTool = asToolExecution(siblings[leader]) as ToolExecutionPatchThis;
  const groupExpanded = isGroupExpanded(leaderTool);
  const members = [leader];
  const thoughts: number[] = [];
  let lastMember = leader;
  let j = leader + 1;
  for (; j <= hi; j++) {
    const cls = verbClasses.get(j);
    if (cls === "member") {
      members.push(j);
      lastMember = j;
    } else if (cls === "thought") {
      thoughts.push(j);
    } else if (cls === "transparent" && groupExpanded && extendsExpandedSpan(siblings[j])) {
      // An expanded group keeps counting individually expanded members; they
      // render their full rows in place instead of a subrow.
      members.push(j);
      lastMember = j;
    } else if (cls !== "transparent") {
      break;
    }
  }
  const span: RegionSpan = { leader, members, thoughts: thoughts.filter((t) => t < lastMember), groupExpanded };
  return { span, next: j };
}

function extendsExpandedSpan(sibling: unknown): boolean {
  const tool = asToolExecution(sibling);
  return tool?.expanded === true && !tool.hideComponent && aggregateRuleFor(tool.toolName) !== undefined;
}

function markRegionThoughts(siblings: unknown[], lo: number, hi: number, groupSpans: RegionSpan[]): void {
  const claimedThoughts = new Set<number>();
  const expandedThoughts = new Set<number>();
  for (const span of groupSpans) {
    collectSpanThoughts(siblings, span, claimedThoughts, expandedThoughts);
  }
  applyRegionThoughtMarkers(siblings, lo, hi, claimedThoughts, expandedThoughts);
}

function collectSpanThoughts(
  siblings: unknown[],
  span: RegionSpan,
  claimedThoughts: Set<number>,
  expandedThoughts: Set<number>,
): void {
  if (span.groupExpanded) {
    const lastMember = span.members[span.members.length - 1] ?? span.leader;
    for (let k = span.leader + 1; k < lastMember; k++) {
      if (isThoughtMember(siblings[k]) || isThoughtTransparent(siblings[k])) expandedThoughts.add(k);
    }
    return;
  }
  for (const t of span.thoughts) claimedThoughts.add(t);
}

function applyRegionThoughtMarkers(
  siblings: unknown[],
  lo: number,
  hi: number,
  claimedThoughts: Set<number>,
  expandedThoughts: Set<number>,
): void {
  for (let k = lo; k <= hi; k++) {
    const claimed = claimedThoughts.has(k);
    const groupExpanded = expandedThoughts.has(k);
    if (isThoughtMember(siblings[k])) setThoughtMemberClaimed(siblings[k] as object, claimed);
    if (isThoughtMember(siblings[k]) || isThoughtTransparent(siblings[k])) {
      setThoughtGroupExpanded(siblings[k] as object, groupExpanded);
    }
  }
}

function assignGroupRoles(roles: Map<number, GroupRole>, siblings: unknown[], groupSpans: RegionSpan[]): Set<number> {
  const spanCovered = new Set<number>();
  for (const span of groupSpans) {
    for (const m of span.members) spanCovered.add(m);
    for (const t of span.thoughts) spanCovered.add(t);
    roles.set(span.leader, {
      role: "verb-leader",
      members: span.members.map((m) => asToolExecution(siblings[m]) as ToolExecutionPatchThis),
      groupExpanded: span.groupExpanded,
    });
    for (const m of span.members) {
      if (m !== span.leader) roles.set(m, { role: "claimed", groupExpanded: span.groupExpanded });
    }
  }
  return spanCovered;
}

function computeTruncationRoles(
  siblings: unknown[],
  lo: number,
  hi: number,
  spanCovered: Set<number>,
  groupMaxVisible: number,
  roles: Map<number, GroupRole>,
): void {
  if (groupMaxVisible <= 0) return;
  const runs = collectTruncationRuns(siblings, lo, hi, spanCovered);
  for (const run of runs) assignTruncationRun(siblings, run, groupMaxVisible, roles);
}

function collectTruncationRuns(siblings: unknown[], lo: number, hi: number, spanCovered: Set<number>): number[][] {
  const runs: number[][] = [];
  let current: number[] = [];
  const flushRun = () => {
    if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  };
  for (let k = lo; k <= hi; k++) {
    if (spanCovered.has(k)) {
      flushRun();
      continue;
    }
    const tool = asToolExecution(siblings[k]);
    if (tool) {
      if (!tool.hideComponent && !tool.expanded) current.push(k);
      continue;
    }
    // Truncation folds contiguous collapsed tools: any sibling that keeps its
    // own rows (unclaimed thought heading, streaming/expanded thinking panel)
    // breaks the run. Zero-line leftovers (claimed thoughts, hidden widgets)
    // are skipped without breaking.
    if (isThoughtTransparent(siblings[k])) {
      flushRun();
      continue;
    }
    if (isThoughtMember(siblings[k]) && !isThoughtMemberClaimed(siblings[k])) {
      flushRun();
    }
  }
  flushRun();
  return runs;
}

function assignTruncationRun(
  siblings: unknown[],
  run: number[],
  groupMaxVisible: number,
  roles: Map<number, GroupRole>,
): void {
  if (run.length <= groupMaxVisible + 1) return;
  const hidden = run.slice(0, run.length - groupMaxVisible);
  roles.set(hidden[0] as number, {
    role: "truncation-leader",
    hidden: hidden.map((m) => asToolExecution(siblings[m]) as ToolExecutionPatchThis),
  });
  for (const m of hidden) {
    if (m !== hidden[0]) roles.set(m, { role: "claimed", groupExpanded: false });
  }
}

function computeGroupRole(component: ToolExecutionPatchThis, width: number): GroupRole | undefined {
  const context = findComponentContextInFrame((component as { ui?: unknown }).ui, component);
  if (!context) return undefined;
  const { siblings, index } = context;

  const isHardBreak = (sibling: unknown): boolean => {
    if (asToolExecution(sibling)) return false;
    if (isThoughtMember(sibling) || isThoughtTransparent(sibling)) return false;
    return componentRendersLines(sibling, width);
  };
  const { lo, hi } = memoizedRegionBounds(siblings, index, width, () => {
    let lo = index;
    while (lo > 0 && !isHardBreak(siblings[lo - 1])) lo--;
    let hi = index;
    while (hi < siblings.length - 1 && !isHardBreak(siblings[hi + 1])) hi++;
    return { lo, hi };
  });

  const roles = memoizedRegionRoles(siblings, lo, hi, width, () => computeRegionRoles(siblings, lo, hi));
  return roles.get(index);
}

export function resolveGroupRole(component: ToolExecutionPatchThis, width: number): GroupRole | undefined {
  return memoizedGroupRole(component, width, () => computeGroupRole(component, width));
}

export function groupRoleSummary(role: GroupRole | undefined): string {
  if (!role) return "none";
  const sig = (members: ToolExecutionPatchThis[]) =>
    members.map((m) => `${m.toolName}${m.isPartial ? "p" : ""}${m.result?.isError === true ? "e" : ""}`).join(",");
  if (role.role === "claimed") return role.groupExpanded ? "claimed:open" : "claimed:shut";
  if (role.role === "truncation-leader") return `trunc:${sig(role.hidden)}`;
  return `lead:${role.groupExpanded ? "open" : "shut"}:${sig(role.members)}`;
}

// The frame counter itself lives in @htwang-contrib/common (frame-epoch.ts) so
// every extension's frame-scoped caches share one bump per TUI doRender.

interface RoleMemoEntry {
  epoch: number;
  mutation: number;
  configVersion: number;
  width: number;
  role: unknown;
}

const roleMemo = new WeakMap<object, RoleMemoEntry>();

// Group roles are recomputed at most once per component per frame; the mutation
// and config versions keep the memo honest if the frame epoch never advances
// (e.g. unit tests rendering without a patched TUI).
function memoizedGroupRole<T>(component: object, width: number, compute: () => T): T {
  const epoch = currentFrameEpoch();
  const mutation = roleMutationVersion;
  const configVersion = getConfigFileVersion();
  const hit = roleMemo.get(component);
  if (
    hit &&
    hit.epoch === epoch &&
    hit.mutation === mutation &&
    hit.configVersion === configVersion &&
    hit.width === width
  ) {
    return hit.role as T;
  }
  const role = compute();
  roleMemo.set(component, { epoch, mutation, configVersion, width, role });
  return role;
}

interface RegionRolesCacheEntry {
  epoch: number;
  mutation: number;
  configVersion: number;
  regions: Map<string, Map<number, unknown>>;
  bounds: Map<string, { lo: number; hi: number }>;
}

const regionRolesCache = new WeakMap<object, RegionRolesCacheEntry>();

function regionCacheEntry(children: object): RegionRolesCacheEntry {
  const epoch = currentFrameEpoch();
  const mutation = roleMutationVersion;
  const configVersion = getConfigFileVersion();
  let entry = regionRolesCache.get(children);
  if (!entry || entry.epoch !== epoch || entry.mutation !== mutation || entry.configVersion !== configVersion) {
    entry = { epoch, mutation, configVersion, regions: new Map(), bounds: new Map() };
    regionRolesCache.set(children, entry);
  }
  return entry;
}

// All components in one hard-break-bounded Region share a single grouping
// computation per frame, instead of each component re-scanning the Region.
function memoizedRegionRoles<T>(
  children: object,
  lo: number,
  hi: number,
  width: number,
  compute: () => Map<number, T>,
): Map<number, T> {
  const entry = regionCacheEntry(children);
  const key = `${lo}:${hi}:${width}`;
  const hit = entry.regions.get(key);
  if (hit) return hit as Map<number, T>;
  const roles = compute();
  entry.regions.set(key, roles);
  return roles;
}

function memoizedRegionBounds(
  children: object,
  index: number,
  width: number,
  compute: () => { lo: number; hi: number },
): { lo: number; hi: number } {
  if (currentFrameEpoch() <= 0) return compute();
  const entry = regionCacheEntry(children);
  const hit = entry.bounds.get(`${width}:${index}`);
  if (hit) return hit;
  const bounds = compute();
  for (let i = bounds.lo; i <= bounds.hi; i++) entry.bounds.set(`${width}:${i}`, bounds);
  return bounds;
}
