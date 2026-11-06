export { applyPatchAdapter } from "./adapters/apply-patch.ts";
export { askUserQuestionAdapter } from "./adapters/ask-user-question.ts";
export { bashAdapter } from "./adapters/bash.ts";
export { codemodeAdapter } from "./adapters/codemode.ts";
export { editAdapter } from "./adapters/edit.ts";
export { globAdapter } from "./adapters/glob.ts";
export {
  createGoalAdapter,
  getGoalAdapter,
  updateGoalAdapter,
} from "./adapters/goal.ts";
export { grepAdapter } from "./adapters/grep.ts";
export {
  journalReadAdapter,
  journalSearchAdapter,
  journalWriteAdapter,
} from "./adapters/journal.ts";
export { lsAdapter } from "./adapters/ls.ts";
export {
  memoryAliasAdapter,
  memoryCreateAdapter,
  memoryDeleteAdapter,
  memoryDomainsAdapter,
  memoryHistoryAdapter,
  memoryListAdapter,
  memoryReadAdapter,
  memorySearchAdapter,
  memoryTriggersAdapter,
  memoryUpdateAdapter,
} from "./adapters/memory.ts";
export { readAdapter } from "./adapters/read.ts";
export {
  createTodoAdapter,
  todoClearAdapter,
  todoCreateAdapter,
  todoDeleteAdapter,
  todoGetAdapter,
  todoListAdapter,
  todoUpdateAdapter,
} from "./adapters/todo.ts";
export { workflowAdapter } from "./adapters/workflow.ts";
export { writeAdapter } from "./adapters/write.ts";
export {
  formatDuration,
  SpinnerTimer,
  spinnerGlyph,
  wrapTextWithAnsi,
} from "./format.ts";
export { globalToolDisplayRegistry } from "./registry.ts";
export {
  defaultCollapsedRenderer,
  defaultExpandedRenderer,
  defaultGenericCollapsedRenderer,
  defaultGenericExpandedRenderer,
  formatGenericToolHeader,
  formatToolArgs,
  renderToolCall,
  ToolCallDisplayComponent,
  type ToolCallDisplayOpts,
  ToolDisplayRegistry,
} from "./tool-call-display.ts";
export type { ContentRenderer, ToolDisplayAdapter } from "./types.ts";

import type { ExtensionAPI, KeybindingHints, Theme } from "@earendil-works/pi-coding-agent";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container, Editor, type TUI, truncateToWidth } from "@earendil-works/pi-tui";
import {
  AGGREGATE_RULE_READY_EVENT,
  AGGREGATE_RULE_REGISTER_EVENT,
  type AggregateRule,
  aggregateRuleFor,
  registerAggregateRule,
} from "@htwang-contrib/common/aggregate-rules";
import { AsyncAnnotations } from "@htwang-contrib/common/async-annotations";
import { componentRendersLines, findComponentContextInFrame } from "@htwang-contrib/common/component-tree";
import { getConfigFileVersion } from "@htwang-contrib/common/config";
import { isExtensionDisabled } from "@htwang-contrib/common/extension-disable";
import { patchTuiFrameEpoch } from "@htwang-contrib/common/frame-epoch";
import { createLogger } from "@htwang-contrib/common/log";
import { loadSystemOneConfig, registerSystemOneConfigItems } from "@htwang-contrib/common/systemone";
import {
  isThoughtMember,
  isThoughtMemberClaimed,
  isThoughtTransparent,
  RAIL_SUBROW_INDENT,
  readRailTailSpacing,
  setThoughtGroupExpanded,
  setThoughtMemberClaimed,
} from "@htwang-contrib/common/tool-rail";
import { currentDeltaRenderVersion, setDeltaRenderInvalidator } from "./adapters/shared.ts";
import {
  aggregateSubrowBodyWidth,
  renderAggregateLine,
  renderAggregateSubrowLine,
  renderTruncationLine,
} from "./aggregate.ts";
import { assessBashCommand, type BashAssessment, formatBashAssessment } from "./bash-assessment.ts";
import { loadConfig, registerToolDisplayConfigItems } from "./config.ts";
import { formatDuration, TIMER_MIN_ELAPSED_MS } from "./format.ts";
import { useHostKeyText } from "./key-text.ts";
import { isMcpTool, MCP_STATUS_EVENT, mcpDisplayName, refreshMcpTools } from "./mcp.ts";
import { globalToolDisplayRegistry } from "./registry.ts";
import {
  bumpComponentState,
  bumpRoleMutation,
  cachedTextOutput,
  componentStateVersion,
  currentProbeDepth,
  currentRenderEnvVersion,
  frameLineCount,
  getCachedRenderLines,
  memoizedGroupRole,
  memoizedRegionBounds,
  memoizedRegionRoles,
  type RenderLinesKey,
  recordFrameLineCount,
  setCachedRenderLines,
} from "./render-cache.ts";
import { formatGenericToolHeader, renderToolCall, type ToolDisplayRegistry, toolBullet } from "./tool-call-display.ts";
import type { ToolDisplayAdapter } from "./types.ts";

type ToolExecutionPatchThis = {
  hideComponent?: boolean;
  __tdHovered?: boolean;
  __tdAggregateLeadingBlank?: boolean;
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  expanded: boolean;
  isPartial: boolean;
  result?: { details?: unknown; isError?: boolean; content?: unknown[] };
  showImages?: boolean;
  toolDefinition?: {
    label?: string;
    description?: string;
    renderCall?: unknown;
    renderResult?: unknown;
  };
  builtInToolDefinition?: {
    label?: string;
    description?: string;
    renderCall?: unknown;
    renderResult?: unknown;
  };
  getTextOutput?: () => string | undefined;
  getCallRenderer?: () => unknown;
  getResultRenderer?: () => unknown;
  setExpanded(expanded: boolean): void;
  invalidate(): void;
};

type PatchedMouseEvent = {
  type: string;
  button?: string;
  width?: number;
  y?: number;
};

let hoveredTool: ToolExecutionPatchThis | undefined;

function clearHoveredTool(): boolean {
  if (!hoveredTool) return false;
  hoveredTool.__tdHovered = false;
  hoveredTool = undefined;
  return true;
}

function patchHoverLeave(target: object): void {
  const proto = target as {
    __tdHoverLeavePatched?: boolean;
    handleMouse?: (this: unknown, event: PatchedMouseEvent) => unknown;
  };
  if (proto.__tdHoverLeavePatched) return;
  proto.__tdHoverLeavePatched = true;
  const original = proto.handleMouse;
  proto.handleMouse = function (this: unknown, event: PatchedMouseEvent) {
    const result = original?.call(this, event);
    if (!result && (event.type === "move" || event.type === "wheel") && clearHoveredTool()) {
      return { handled: true, render: true };
    }
    return result;
  };
}

function installHoverLeavePatches() {
  patchHoverLeave(Container.prototype);
  // ToolExecutionComponent may extend a different Container instance than the one
  // this module resolves (duplicate pi-tui copies in the dependency tree); patch its
  // actual base class so hover-leave covers the real dispatch chain.
  const baseContainerProto = Object.getPrototypeOf(ToolExecutionComponent.prototype);
  if (baseContainerProto && baseContainerProto !== Container.prototype) {
    patchHoverLeave(baseContainerProto);
  }
  patchHoverLeave(Editor.prototype);
}

const FALLBACK_THEME: Theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

function findPreviousVisibleSibling(root: unknown, target: object, width: number): unknown {
  const context = findComponentContextInFrame(root, target);
  if (!context) return undefined;
  const { siblings, index } = context;
  for (let i = index - 1; i >= 0; i--) {
    const candidate = siblings[i];
    // Siblings ahead of the target have already rendered this frame (parents
    // render top-down), so their recorded line counts answer the probe without
    // re-invoking their render.
    const known = candidate && typeof candidate === "object" ? frameLineCount(candidate) : undefined;
    if (known !== undefined) {
      if (known > 0) return candidate;
      continue;
    }
    if (componentRendersLines(candidate, width)) return candidate;
  }
  return null;
}

function findPreviousVisibleOf(component: ToolExecutionPatchThis, width: number): unknown {
  const ui = (component as { ui?: unknown }).ui;
  if (!ui) return undefined;
  return findPreviousVisibleSibling(ui, component, width);
}

function asToolExecution(component: unknown): ToolExecutionPatchThis | undefined {
  return component instanceof ToolExecutionComponent ? (component as unknown as ToolExecutionPatchThis) : undefined;
}

const aggregateGroupState = new WeakMap<ToolExecutionPatchThis, { expanded: boolean }>();

type GroupRole =
  | { role: "verb-leader"; members: ToolExecutionPatchThis[]; groupExpanded: boolean }
  | { role: "truncation-leader"; hidden: ToolExecutionPatchThis[] }
  | { role: "claimed"; groupExpanded: boolean };

// Grouping is computed once per hard-break-bounded region per frame and shared
// by every component in the region (memoizedRegionRoles). The scan covers the
// region around the component: verb-group claims rule-registered tools and
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
    const headsExpandedGroup =
      groupToolVerbs &&
      aggregateRuleFor(tool.toolName) !== undefined &&
      aggregateGroupState.get(tool)?.expanded === true;
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
  const groupExpanded = aggregateGroupState.get(leaderTool)?.expanded === true;
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

function resolveGroupRole(component: ToolExecutionPatchThis, width: number): GroupRole | undefined {
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

function aggregateMemberStates(members: ToolExecutionPatchThis[]) {
  return members.map((member) => ({
    toolName: member.toolName,
    isPartial: member.isPartial,
    isError: member.result?.isError === true,
  }));
}

function renderAggregateMemberSubrow(
  component: ToolExecutionPatchThis,
  theme: Theme,
  width: number,
  registry: ToolDisplayRegistry,
  headerAnnotation?: string,
): string {
  const bodyWidth = aggregateSubrowBodyWidth(width);
  const adapter = registry.get(component.toolName);
  const output = component.result ? component.getTextOutput?.() : undefined;
  const header =
    adapter?.formatCallHeader(
      component.args,
      theme,
      component.result?.details,
      component.isPartial,
      false,
      bodyWidth,
      output,
      headerAnnotation,
    ) ?? formatGenericToolHeader(component.toolName, component.args, theme, Math.max(1, bodyWidth));
  const bullet = toolBullet(
    component.toolName,
    component.isPartial,
    component.result?.isError === true,
    component.result?.details,
    theme,
    Date.now(),
    component.__tdHovered === true,
  );
  return renderAggregateSubrowLine((header.split("\n")[0] ?? "").trimEnd(), bullet.bullet, bullet.status, theme, width);
}

function applyGroupSpacing(lines: string[], previous: unknown, ensureLeadingBlank: boolean): string[] {
  const hasLeadingBlank = lines.length > 0 && lines[0].trim() === "";
  // A rail-tail marker means the sibling above already emitted the configured
  // gap after its thinking rail line, so the tool must not add its own blank.
  if (previous instanceof ToolExecutionComponent || readRailTailSpacing(previous) !== undefined) {
    return hasLeadingBlank ? lines.slice(1) : lines;
  }
  if (ensureLeadingBlank && !hasLeadingBlank) {
    return ["", ...lines];
  }
  return lines;
}

function patchToolExecutionRender(
  getTheme: () => Theme,
  registry: typeof globalToolDisplayRegistry,
  getHeaderAnnotation: (toolCallId: string) => string | undefined,
) {
  const proto: any = ToolExecutionComponent.prototype;
  proto.__tdGetTheme = getTheme;
  proto.__tdRegistry = registry;
  proto.__tdGetHeaderAnnotation = getHeaderAnnotation;

  // The host injects its configured keybindings into each tool row's render
  // context; capture it once so collapsed/expanded hints show the real key.
  useHostKeyText((proto.getRenderContext?.call({}) as { keyText?: KeybindingHints["keyText"] } | undefined)?.keyText);

  installHoverLeavePatches();

  if (proto.__tdPatched) return;

  const timings = new WeakMap<object, { startedAtMs?: number; endedAtMs?: number }>();

  const originalSetExpanded = proto.setExpanded as (this: ToolExecutionPatchThis, expanded: boolean) => void;
  proto.setExpanded = function (this: ToolExecutionPatchThis, expanded: boolean) {
    originalSetExpanded.call(this, expanded);
    this.invalidate();
  };

  const originalUpdateDisplay = proto.updateDisplay as ((this: ToolExecutionPatchThis) => void) | undefined;
  if (typeof originalUpdateDisplay === "function") {
    proto.updateDisplay = function (this: ToolExecutionPatchThis) {
      bumpComponentState(this);
      originalUpdateDisplay.call(this);
    };
  }

  function groupRoleSummary(role: GroupRole | undefined): string {
    if (!role) return "none";
    const sig = (members: ToolExecutionPatchThis[]) =>
      members.map((m) => `${m.toolName}${m.isPartial ? "p" : ""}${m.result?.isError === true ? "e" : ""}`).join(",");
    if (role.role === "claimed") return role.groupExpanded ? "claimed:open" : "claimed:shut";
    if (role.role === "truncation-leader") return `trunc:${sig(role.hidden)}`;
    return `lead:${role.groupExpanded ? "open" : "shut"}:${sig(role.members)}`;
  }

  function renderToolExecutionUncached(
    component: ToolExecutionPatchThis,
    width: number,
    theme: Theme,
    headerAnnotation: string | undefined,
    groupRole: GroupRole | undefined,
    previous: unknown,
  ): string[] {
    if (groupRole?.role === "claimed" && !component.expanded) {
      return renderClaimedMember(component, groupRole, width, theme, headerAnnotation);
    }

    let aggregatePrefix: string[] = [];
    if (groupRole?.role === "verb-leader") {
      const header = renderGroupHeader(component, groupRole, width, theme, previous, headerAnnotation);
      if (header.finished) return header.finished;
      aggregatePrefix = header.prefix;
    }
    if (groupRole?.role === "truncation-leader") {
      const lines = renderTruncationLine(
        aggregateMemberStates(groupRole.hidden),
        loadConfig().groupToolVerbs,
        theme,
        width,
      );
      return applyGroupSpacing(lines, previous, true);
    }

    return renderAdapterLines(
      component,
      width,
      theme,
      headerAnnotation,
      aggregatePrefix,
      previous,
      expandedGroupIndent(component, groupRole),
    );
  }

  // A tool showing its full block inside an expanded group keeps the subrow
  // alignment of its collapsed siblings instead of dropping back to top-level
  // columns.
  function expandedGroupIndent(component: ToolExecutionPatchThis, groupRole: GroupRole | undefined): number {
    if (!component.expanded) return 0;
    if (groupRole?.role === "claimed" && groupRole.groupExpanded) return RAIL_SUBROW_INDENT;
    if (groupRole?.role === "verb-leader" && groupRole.groupExpanded) return RAIL_SUBROW_INDENT;
    return 0;
  }

  function renderClaimedMember(
    component: ToolExecutionPatchThis,
    groupRole: Extract<GroupRole, { role: "claimed" }>,
    width: number,
    theme: Theme,
    headerAnnotation: string | undefined,
  ): string[] {
    if (!groupRole.groupExpanded) return [];
    return [renderAggregateMemberSubrow(component, theme, width, proto.__tdRegistry, headerAnnotation)];
  }

  function renderGroupHeader(
    component: ToolExecutionPatchThis,
    groupRole: Extract<GroupRole, { role: "verb-leader" }>,
    width: number,
    theme: Theme,
    previous: unknown,
    headerAnnotation: string | undefined,
  ): { finished?: string[]; prefix: string[] } {
    const lines = renderAggregateLine(
      aggregateMemberStates(groupRole.members),
      theme,
      width,
      Date.now(),
      groupRole.groupExpanded,
    );
    // Click routing must match the layout the TUI routed the event against, so the
    // separator state is captured at render time instead of being recomputed from the
    // mouse event's width.
    component.__tdAggregateLeadingBlank =
      !(previous instanceof ToolExecutionComponent) && readRailTailSpacing(previous) === undefined;
    if (!groupRole.groupExpanded) {
      return { finished: applyGroupSpacing(lines, previous, true), prefix: [] };
    }
    if (!component.expanded) {
      lines.push(renderAggregateMemberSubrow(component, theme, width, proto.__tdRegistry, headerAnnotation));
      return { finished: applyGroupSpacing(lines, previous, true), prefix: [] };
    }
    return { prefix: lines };
  }

  function renderAdapterLines(
    component: ToolExecutionPatchThis,
    width: number,
    theme: Theme,
    headerAnnotation: string | undefined,
    aggregatePrefix: string[],
    previous: unknown,
    indent: number,
  ): string[] {
    const reg = proto.__tdRegistry;
    const adapter = reg.get(component.toolName);
    const mcpOwned = isMcpOwned(component, adapter);
    if (usesStockRenderer(component, adapter, mcpOwned)) {
      const lines = originalRender.call(component, width) as string[];
      const indented = indent > 0 ? lines.map((line) => truncateToWidth(" ".repeat(indent) + line, width, "…")) : lines;
      return applyGroupSpacing(indented, previous, false);
    }

    const opts = buildToolCallOpts(component, reg, mcpOwned, headerAnnotation, indent);
    const rendered = renderToolCall(opts, theme);
    const lines = rendered.render(width);

    return applyGroupSpacing([...aggregatePrefix, ...lines], previous, true);
  }

  function isMcpOwned(component: ToolExecutionPatchThis, adapter: unknown): boolean {
    return !adapter && isMcpTool(component.toolName, component.toolDefinition?.label) && loadConfig().mcpToolCalls;
  }

  function usesStockRenderer(component: ToolExecutionPatchThis, adapter: unknown, mcpOwned: boolean): boolean {
    if (adapter || mcpOwned) return false;
    const callR = component.getCallRenderer?.();
    const resultR = component.result ? component.getResultRenderer?.() : undefined;
    return callR != null || resultR != null;
  }

  function buildToolCallOpts(
    component: ToolExecutionPatchThis,
    reg: typeof globalToolDisplayRegistry,
    mcpOwned: boolean,
    headerAnnotation: string | undefined,
    indent: number,
  ) {
    const getTextOutput = component.getTextOutput?.bind(component);
    const output = component.result
      ? cachedTextOutput(component.result, component.showImages === true, () => getTextOutput?.())
      : undefined;

    const timing = timings.get(component) ?? {};

    return {
      toolName: component.toolName,
      args: component.args,
      output,
      details: component.result?.details,
      expanded: component.expanded,
      isPartial: component.isPartial,
      isError: component.result?.isError ?? false,
      registry: reg,
      startedAtMs: timing.startedAtMs,
      endedAtMs: timing.endedAtMs,
      hoverAffordance: component.__tdHovered === true && !component.expanded,
      displayName: mcpOwned ? mcpDisplayName(component.toolName, component.toolDefinition?.label) : undefined,
      headerAnnotation,
      indent,
    };
  }

  const originalRender = proto.render;
  proto.render = function (this: ToolExecutionPatchThis, width: number): string[] {
    if (this.hideComponent) {
      recordFrameLineCount(this, 0);
      return [];
    }
    return renderToolExecutionCached(this, width);
  };

  function renderToolExecutionCached(component: ToolExecutionPatchThis, width: number): string[] {
    const theme = proto.__tdGetTheme?.() ?? FALLBACK_THEME;
    const headerAnnotation =
      component.toolName === "bash" ? proto.__tdGetHeaderAnnotation?.(component.toolCallId) : undefined;
    const groupRole = memoizedGroupRole<GroupRole | undefined>(component, width, () =>
      resolveGroupRole(component, width),
    );

    // Claimed members render either nothing or a bare subrow; neither applies
    // group spacing, so the backward visibility probe is skipped for them.
    const skipPrev = groupRole?.role === "claimed" && !component.expanded;
    const previous = skipPrev ? undefined : findPreviousVisibleOf(component, width);

    const now = Date.now();
    const timing = updateRenderTimings(component, now);
    const key = renderLinesCacheKey(component, width, previous, groupRole, headerAnnotation, theme, timing, now);
    const cached = getCachedRenderLines(component, key);
    if (cached) {
      recordFrameLineCount(component, cached.length);
      return cached;
    }
    const lines = renderToolExecutionUncached(component, width, theme, headerAnnotation, groupRole, previous);
    setCachedRenderLines(component, key, lines);
    recordFrameLineCount(component, lines.length);
    return lines;
  }

  function updateRenderTimings(component: ToolExecutionPatchThis, now: number) {
    const existing = timings.get(component) ?? {};
    const startedAtMs = existing.startedAtMs ?? now;
    const endedAtMs = existing.endedAtMs ?? (!component.isPartial && component.result ? now : undefined);
    timings.set(component, { startedAtMs, endedAtMs });
    return { startedAtMs, endedAtMs };
  }

  function spinMembersOf(groupRole: GroupRole | undefined): ToolExecutionPatchThis[] | undefined {
    if (groupRole === undefined) return undefined;
    return roleMembers(groupRole);
  }

  function roleMembers(groupRole: GroupRole): ToolExecutionPatchThis[] | undefined {
    if (groupRole.role === "verb-leader") return groupRole.members;
    if (groupRole.role === "truncation-leader") return groupRole.hidden;
    return undefined;
  }

  function anyMemberPartial(members: ToolExecutionPatchThis[] | undefined): boolean {
    return members?.some((member) => member.isPartial) === true;
  }

  function spinTickOf(spins: boolean, now: number): number {
    return spins ? Math.floor(now / 80) : 0;
  }

  function renderLinesCacheKey(
    component: ToolExecutionPatchThis,
    width: number,
    previous: unknown,
    groupRole: GroupRole | undefined,
    headerAnnotation: string | undefined,
    theme: Theme,
    timing: { startedAtMs: number; endedAtMs?: number },
    now: number,
  ): RenderLinesKey {
    const spins = component.isPartial || anyMemberPartial(spinMembersOf(groupRole));
    const elapsedMs = (timing.endedAtMs ?? now) - timing.startedAtMs;
    const timerLabel = elapsedMs >= TIMER_MIN_ELAPSED_MS ? formatDuration(elapsedMs) : undefined;
    return {
      width,
      probed: currentProbeDepth() > 0,
      stateVersion: componentStateVersion(component),
      hovered: component.__tdHovered === true,
      headerAnnotation,
      roleSummary: groupRoleSummary(groupRole),
      prevIsTool: previous instanceof ToolExecutionComponent,
      prevHasRailTail: readRailTailSpacing(previous) !== undefined,
      spinTick: spinTickOf(spins, now),
      timerLabel,
      theme,
      envVersion: currentRenderEnvVersion(),
      configVersion: getConfigFileVersion(),
      deltaVersion: currentDeltaRenderVersion(),
    };
  }

  const originalHandleMouse = proto.handleMouse as
    | ((this: ToolExecutionPatchThis, event: PatchedMouseEvent) => unknown)
    | undefined;

  function toggleAggregateGroup(leader: ToolExecutionPatchThis, members: ToolExecutionPatchThis[]): void {
    if (aggregateGroupState.get(leader)?.expanded) {
      aggregateGroupState.delete(leader);
      for (const member of members) {
        if (member.expanded) member.setExpanded(false);
      }
      bumpRoleMutation();
      return;
    }
    aggregateGroupState.set(leader, { expanded: true });
    bumpRoleMutation();
  }

  function handleAggregateClick(
    component: ToolExecutionPatchThis,
    role: Extract<GroupRole, { role: "verb-leader" | "claimed" }>,
    event: PatchedMouseEvent,
  ): { handled: true } | undefined {
    if (role.role === "verb-leader") return handleLeaderClick(component, role, event);
    return handleMemberClick(component, role);
  }

  function handleLeaderClick(
    component: ToolExecutionPatchThis,
    role: Extract<GroupRole, { role: "verb-leader" }>,
    event: PatchedMouseEvent,
  ): { handled: true } | undefined {
    const summaryY = component.__tdAggregateLeadingBlank === true ? 1 : 0;
    const y = event.y ?? 0;
    if (role.groupExpanded && y > summaryY) return toggleExpandedWithResult(component);
    if (y < summaryY) return undefined;
    toggleAggregateGroup(component, role.members);
    return { handled: true };
  }

  function handleMemberClick(
    component: ToolExecutionPatchThis,
    role: Extract<GroupRole, { role: "claimed" }>,
  ): { handled: true } | undefined {
    if (!role.groupExpanded) return undefined;
    return toggleExpandedWithResult(component);
  }

  function toggleExpandedWithResult(component: ToolExecutionPatchThis): { handled: true } | undefined {
    if (!component.expanded && !component.result) return undefined;
    component.setExpanded(!component.expanded);
    return { handled: true };
  }

  function resolveEventGroupRole(component: ToolExecutionPatchThis, event: PatchedMouseEvent): GroupRole | undefined {
    const width = event.width ?? 0;
    return memoizedGroupRole<GroupRole | undefined>(component, width, () => resolveGroupRole(component, width));
  }

  function dispatchGroupClick(component: ToolExecutionPatchThis, event: PatchedMouseEvent) {
    const groupRole = resolveEventGroupRole(component, event);
    if (!groupRole) return undefined;
    if (event.button !== "left") return undefined;
    if (groupRole.role === "truncation-leader") return undefined;
    return handleAggregateClick(component, groupRole, event);
  }

  proto.handleMouse = function (this: ToolExecutionPatchThis, event: PatchedMouseEvent) {
    if (event.type === "click" && resolveEventGroupRole(this, event)) {
      return dispatchGroupClick(this, event);
    }
    // Claim hover moves before the stock handler: for default-shell tools the stock
    // handleMouse delegates through Container.prototype.handleMouse, which the
    // hover-leave patch treats as an unclaimed move and clears hover while the cursor
    // is still inside this widget — flipping the bullet between › and ◆ on every move.
    const hover = claimHoverMove(this, event);
    if (hover) return hover;
    const childResult = originalHandleMouse?.call(this, event);
    if (childResult) return childResult;
    return finishUnclaimedClick(this, event);
  };

  function claimHoverMove(
    component: ToolExecutionPatchThis,
    event: PatchedMouseEvent,
  ): { handled: true; render?: boolean } | undefined {
    if (event.type !== "move" || !component.result || component.expanded) return undefined;
    if (hoveredTool === component && component.__tdHovered) return { handled: true };
    clearHoveredTool();
    hoveredTool = component;
    component.__tdHovered = true;
    return { handled: true, render: true };
  }

  function finishUnclaimedClick(
    component: ToolExecutionPatchThis,
    event: PatchedMouseEvent,
  ): { handled: true } | undefined {
    if (event.type === "move") return undefined;
    const ownedByPatch =
      proto.__tdRegistry.get(component.toolName) !== undefined ||
      (isMcpTool(component.toolName, component.toolDefinition?.label) && loadConfig().mcpToolCalls);
    if (!ownedByPatch) return undefined;
    // Adapter-rendered blocks bypass the stock MouseRegion wrappers: the patched render
    // never updates selfRenderHeight (edit is renderShell "self"), and default-shell child
    // heights no longer match our rendered lines. Finish unhandled left clicks ourselves,
    // mirroring the stock createResultRegion semantics.
    if (!component.result || event.type !== "click" || event.button !== "left") return undefined;
    component.setExpanded(!component.expanded);
    return { handled: true };
  }
  proto.__tdPatched = true;
}

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled("tool-display")) return;
  let activeTheme: Theme = FALLBACK_THEME;
  let isTui = false;
  let tui: TUI | undefined;
  const logger = createLogger("tool-display");
  const assessments = new AsyncAnnotations<BashAssessment>(
    () => {
      tui?.invalidate();
      tui?.requestRender();
    },
    (error) => logger.warn(`Bash assessment failed: ${String(error)}`),
  );
  const getHeaderAnnotation = (toolCallId: string) => {
    if (!loadConfig().bashAssessment) return undefined;
    const assessment = assessments.get(toolCallId);
    return assessment ? formatBashAssessment(assessment) : undefined;
  };

  pi.events.on("tool-display:register", (data) => {
    const { toolName, adapter } = data as {
      toolName: string;
      adapter: ToolDisplayAdapter;
    };
    globalToolDisplayRegistry.register(toolName, adapter);
  });

  pi.events.on(AGGREGATE_RULE_REGISTER_EVENT, (data) => {
    const { toolName, rule } = data as { toolName: string; rule: AggregateRule };
    registerAggregateRule(toolName, rule);
    bumpRoleMutation();
  });

  pi.events.on(MCP_STATUS_EVENT, () => {
    refreshMcpTools(pi);
  });

  pi.events.emit("tool-display:ready", undefined);
  pi.events.emit(AGGREGATE_RULE_READY_EVENT, undefined);

  pi.on("session_start", (_event, ctx) => {
    assessments.reset();
    isTui = ctx.mode === "tui";
    if (!isTui) return;
    registerToolDisplayConfigItems();
    registerSystemOneConfigItems();
    ctx.ui.setWidget?.("tool-display:render-handle", (ui) => {
      tui = ui;
      patchTuiFrameEpoch(ui);
      setDeltaRenderInvalidator(() => {
        tui?.invalidate();
        tui?.requestRender();
      });
      return { render: () => [], invalidate() {} };
    });
    if (ctx.ui?.theme) {
      activeTheme = ctx.ui.theme;
    }
    refreshMcpTools(pi);
    patchToolExecutionRender(() => activeTheme, globalToolDisplayRegistry, getHeaderAnnotation);
  });

  pi.on("tool_call", (event, ctx) => {
    if (!isTui || event.toolName !== "bash") return;
    requestBashAssessment(event, ctx);
  });

  function requestBashAssessment(
    event: { toolCallId: string; input: Record<string, unknown> },
    ctx: { cwd: string; signal: AbortSignal | undefined },
  ): void {
    try {
      if (!loadConfig().bashAssessment || !loadSystemOneConfig().apiKey?.trim()) return;
      const command = event.input.command;
      if (typeof command !== "string" || !command.trim()) return;
      const cwd = "workdir" in event.input && typeof event.input.workdir === "string" ? event.input.workdir : ctx.cwd;
      assessments.request(event.toolCallId, (signal) => assessBashCommand(command, cwd, signal), ctx.signal);
    } catch (error) {
      logger.warn(`Bash assessment setup failed: ${String(error)}`);
    }
  }

  pi.on("session_shutdown", () => {
    isTui = false;
    assessments.dispose();
    setDeltaRenderInvalidator(undefined);
    tui = undefined;
  });

  pi.on("before_agent_start", () => {
    if (!isTui) return;
    refreshMcpTools(pi);
    patchToolExecutionRender(() => activeTheme, globalToolDisplayRegistry, getHeaderAnnotation);
  });
}
