export { applyPatchAdapter } from "./adapters/apply-patch.ts";
export { askUserQuestionAdapter } from "./adapters/ask-user-question.ts";
export { bashAdapter } from "./adapters/bash.ts";
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

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container, Editor, type TUI } from "@earendil-works/pi-tui";
import {
  AGGREGATE_RULE_READY_EVENT,
  AGGREGATE_RULE_REGISTER_EVENT,
  type AggregateRule,
  AsyncAnnotations,
  aggregateRuleFor,
  componentRendersLines,
  createLogger,
  findComponentContext,
  isExtensionDisabled,
  isThoughtMember,
  isThoughtMemberClaimed,
  isThoughtTransparent,
  loadSystemOneConfig,
  readRailTailSpacing,
  registerAggregateRule,
  registerSystemOneConfigItems,
  setThoughtMemberClaimed,
} from "@htwang-contrib/common";
import {
  aggregateSubrowBodyWidth,
  renderAggregateLine,
  renderAggregateSubrowLine,
  renderTruncationLine,
} from "./aggregate.ts";
import { assessBashCommand, type BashAssessment, formatBashAssessment } from "./bash-assessment.ts";
import { loadConfig, registerToolDisplayConfigItems } from "./config.ts";
import { isMcpTool, MCP_STATUS_EVENT, mcpDisplayName, refreshMcpTools } from "./mcp.ts";
import { globalToolDisplayRegistry } from "./registry.ts";
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
  const context = findComponentContext(root, target);
  if (!context) return undefined;
  const { siblings, index } = context;
  for (let i = index - 1; i >= 0; i--) {
    const candidate = siblings[i];
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

// Grouping is recomputed from the chat sibling list on every render, so leader
// election stays idempotent across streaming appends and session replay. The
// scan covers the hard-break-bounded region around the component: verb-group
// claims rule-registered tools and eligible ThoughtMembers first, then the
// truncation layer folds what remains of over-long dense tool runs.
function resolveGroupRole(component: ToolExecutionPatchThis, width: number): GroupRole | undefined {
  const context = findComponentContext((component as { ui?: unknown }).ui, component);
  if (!context) return undefined;
  const { siblings, index } = context;
  const { groupToolVerbs, groupMaxVisible } = loadConfig();

  const isHardBreak = (sibling: unknown): boolean => {
    if (asToolExecution(sibling)) return false;
    if (isThoughtMember(sibling) || isThoughtTransparent(sibling)) return false;
    return componentRendersLines(sibling, width);
  };
  let lo = index;
  while (lo > 0 && !isHardBreak(siblings[lo - 1])) lo--;
  let hi = index;
  while (hi < siblings.length - 1 && !isHardBreak(siblings[hi + 1])) hi++;

  type VerbClass = "member" | "thought" | "transparent" | "break";
  const verbClasses = new Map<number, VerbClass>();
  for (let i = lo; i <= hi; i++) {
    const sibling = siblings[i];
    const tool = asToolExecution(sibling);
    if (tool) {
      if (tool.hideComponent) {
        verbClasses.set(i, "transparent");
      } else if (tool.expanded) {
        // A leader expanded through its own subrow keeps heading its expanded
        // group; any other expanded tool is Transparent to the scan.
        const headsExpandedGroup =
          groupToolVerbs &&
          aggregateRuleFor(tool.toolName) !== undefined &&
          aggregateGroupState.get(tool)?.expanded === true;
        verbClasses.set(i, headsExpandedGroup ? "member" : "transparent");
      } else if (groupToolVerbs && aggregateRuleFor(tool.toolName) !== undefined) {
        verbClasses.set(i, "member");
      } else {
        verbClasses.set(i, "break");
      }
    } else if (isThoughtMember(sibling)) {
      verbClasses.set(i, "thought");
    } else {
      verbClasses.set(i, "transparent");
    }
  }

  const spans: { leader: number; members: number[]; thoughts: number[]; groupExpanded: boolean }[] = [];
  let i = lo;
  while (i <= hi) {
    if (verbClasses.get(i) !== "member") {
      i++;
      continue;
    }
    const leaderTool = asToolExecution(siblings[i]) as ToolExecutionPatchThis;
    const groupExpanded = aggregateGroupState.get(leaderTool)?.expanded === true;
    const members = [i];
    const thoughts: number[] = [];
    let lastMember = i;
    let j = i + 1;
    for (; j <= hi; j++) {
      const cls = verbClasses.get(j);
      if (cls === "member") {
        members.push(j);
        lastMember = j;
      } else if (cls === "thought") {
        thoughts.push(j);
      } else if (cls === "transparent" && groupExpanded) {
        // An expanded group keeps counting individually expanded members; they
        // render their full rows in place instead of a subrow.
        const tool = asToolExecution(siblings[j]);
        if (tool?.expanded && !tool.hideComponent && aggregateRuleFor(tool.toolName) !== undefined) {
          members.push(j);
          lastMember = j;
        }
      } else if (cls !== "transparent") {
        break;
      }
    }
    spans.push({ leader: i, members, thoughts: thoughts.filter((t) => t < lastMember), groupExpanded });
    i = j;
  }

  const claimedThoughts = new Set<number>();
  for (const span of spans) {
    if (span.groupExpanded) continue;
    for (const t of span.thoughts) claimedThoughts.add(t);
  }
  for (let k = lo; k <= hi; k++) {
    if (verbClasses.get(k) === "thought") {
      setThoughtMemberClaimed(siblings[k] as object, claimedThoughts.has(k));
    }
  }

  const spanCovered = new Set<number>();
  for (const span of spans) {
    for (const m of span.members) spanCovered.add(m);
    for (const t of span.thoughts) spanCovered.add(t);
  }

  for (const span of spans) {
    if (index === span.leader) {
      return {
        role: "verb-leader",
        members: span.members.map((m) => asToolExecution(siblings[m]) as ToolExecutionPatchThis),
        groupExpanded: span.groupExpanded,
      };
    }
    if (span.members.includes(index)) return { role: "claimed", groupExpanded: span.groupExpanded };
  }

  if (groupMaxVisible > 0) {
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

    for (const run of runs) {
      if (run.length <= groupMaxVisible + 1) continue;
      const hidden = run.slice(0, run.length - groupMaxVisible);
      if (index === hidden[0]) {
        return {
          role: "truncation-leader",
          hidden: hidden.map((m) => asToolExecution(siblings[m]) as ToolExecutionPatchThis),
        };
      }
      if (hidden.includes(index)) return { role: "claimed", groupExpanded: false };
    }
  }

  return undefined;
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

  installHoverLeavePatches();

  if (proto.__tdPatched) return;

  const timings = new WeakMap<object, { startedAtMs?: number; endedAtMs?: number }>();

  const originalSetExpanded = proto.setExpanded as (this: ToolExecutionPatchThis, expanded: boolean) => void;
  proto.setExpanded = function (this: ToolExecutionPatchThis, expanded: boolean) {
    originalSetExpanded.call(this, expanded);
    this.invalidate();
  };

  const originalRender = proto.render;
  proto.render = function (this: ToolExecutionPatchThis, width: number): string[] {
    if (this.hideComponent) return [];
    const headerAnnotation = this.toolName === "bash" ? proto.__tdGetHeaderAnnotation?.(this.toolCallId) : undefined;

    const groupRole = resolveGroupRole(this, width);
    if (groupRole?.role === "claimed") {
      if (!this.expanded) {
        if (!groupRole.groupExpanded) return [];
        const theme = proto.__tdGetTheme?.() ?? FALLBACK_THEME;
        return [renderAggregateMemberSubrow(this, theme, width, proto.__tdRegistry, headerAnnotation)];
      }
    }

    let aggregatePrefix: string[] = [];
    if (groupRole?.role === "verb-leader") {
      const theme = proto.__tdGetTheme?.() ?? FALLBACK_THEME;
      const lines = renderAggregateLine(
        aggregateMemberStates(groupRole.members),
        theme,
        width,
        Date.now(),
        groupRole.groupExpanded,
      );
      const previous = findPreviousVisibleOf(this, width);
      // Click routing must match the layout the TUI routed the event against, so the
      // separator state is captured at render time instead of being recomputed from the
      // mouse event's width.
      this.__tdAggregateLeadingBlank =
        !(previous instanceof ToolExecutionComponent) && readRailTailSpacing(previous) === undefined;
      if (!groupRole.groupExpanded) {
        return applyGroupSpacing(lines, previous, true);
      }
      if (!this.expanded) {
        lines.push(renderAggregateMemberSubrow(this, theme, width, proto.__tdRegistry, headerAnnotation));
        return applyGroupSpacing(lines, previous, true);
      }
      aggregatePrefix = lines;
    }
    if (groupRole?.role === "truncation-leader") {
      const theme = proto.__tdGetTheme?.() ?? FALLBACK_THEME;
      const lines = renderTruncationLine(
        aggregateMemberStates(groupRole.hidden),
        loadConfig().groupToolVerbs,
        theme,
        width,
      );
      return applyGroupSpacing(lines, findPreviousVisibleOf(this, width), true);
    }

    const reg = proto.__tdRegistry;
    const adapter = reg.get(this.toolName);
    const callR = this.getCallRenderer?.();
    const resultR = this.result ? this.getResultRenderer?.() : undefined;
    const mcpOwned = !adapter && isMcpTool(this.toolName, this.toolDefinition?.label) && loadConfig().mcpToolCalls;
    if (!adapter && (callR != null || resultR != null) && !mcpOwned) {
      const lines = originalRender.call(this, width) as string[];
      return applyGroupSpacing(lines, findPreviousVisibleOf(this, width), false);
    }

    const getTextOutput = this.getTextOutput?.bind(this);
    const output = this.result ? getTextOutput?.() : undefined;

    const timing = timings.get(this) ?? {};
    if (timing.startedAtMs === undefined) timing.startedAtMs = Date.now();
    if (!this.isPartial && this.result && timing.endedAtMs === undefined) {
      timing.endedAtMs = Date.now();
    }
    timings.set(this, timing);

    const opts = {
      toolName: this.toolName,
      args: this.args,
      output,
      details: this.result?.details,
      expanded: this.expanded,
      isPartial: this.isPartial,
      isError: this.result?.isError ?? false,
      registry: reg,
      startedAtMs: timing.startedAtMs,
      endedAtMs: timing.endedAtMs,
      hoverAffordance: this.__tdHovered === true && !this.expanded,
      displayName: mcpOwned ? mcpDisplayName(this.toolName, this.toolDefinition?.label) : undefined,
      headerAnnotation,
    };

    const theme = proto.__tdGetTheme?.() ?? FALLBACK_THEME;
    const rendered = renderToolCall(opts, theme);
    const lines = rendered.render(width);

    return applyGroupSpacing([...aggregatePrefix, ...lines], findPreviousVisibleOf(this, width), true);
  };

  const originalHandleMouse = proto.handleMouse as
    | ((this: ToolExecutionPatchThis, event: PatchedMouseEvent) => unknown)
    | undefined;

  function toggleAggregateGroup(leader: ToolExecutionPatchThis, members: ToolExecutionPatchThis[]): void {
    if (aggregateGroupState.get(leader)?.expanded) {
      aggregateGroupState.delete(leader);
      for (const member of members) {
        if (member.expanded) member.setExpanded(false);
      }
      return;
    }
    aggregateGroupState.set(leader, { expanded: true });
  }

  function handleAggregateClick(
    component: ToolExecutionPatchThis,
    role: Extract<GroupRole, { role: "verb-leader" | "claimed" }>,
    event: PatchedMouseEvent,
  ): { handled: true } | undefined {
    if (role.role === "verb-leader") {
      const summaryY = component.__tdAggregateLeadingBlank === true ? 1 : 0;
      const y = event.y ?? 0;
      if (role.groupExpanded && y > summaryY) {
        if (!component.expanded && !component.result) return undefined;
        component.setExpanded(!component.expanded);
        return { handled: true };
      }
      if (y < summaryY) return undefined;
      toggleAggregateGroup(component, role.members);
      return { handled: true };
    }
    if (!role.groupExpanded) return undefined;
    if (!component.expanded && !component.result) return undefined;
    component.setExpanded(!component.expanded);
    return { handled: true };
  }

  proto.handleMouse = function (this: ToolExecutionPatchThis, event: PatchedMouseEvent) {
    if (event.type === "click") {
      const groupRole = resolveGroupRole(this, event.width ?? 0);
      if (groupRole) {
        if (event.button !== "left") return undefined;
        if (groupRole.role === "truncation-leader") return undefined;
        return handleAggregateClick(this, groupRole, event);
      }
    }
    // Claim hover moves before the stock handler: for default-shell tools the stock
    // handleMouse delegates through Container.prototype.handleMouse, which the
    // hover-leave patch treats as an unclaimed move and clears hover while the cursor
    // is still inside this widget — flipping the bullet between › and ◆ on every move.
    if (event.type === "move" && this.result && !this.expanded) {
      if (hoveredTool === this && this.__tdHovered) return { handled: true };
      clearHoveredTool();
      hoveredTool = this;
      this.__tdHovered = true;
      return { handled: true, render: true };
    }
    const childResult = originalHandleMouse?.call(this, event);
    if (childResult) return childResult;
    if (event.type === "move") return undefined;
    const ownedByPatch =
      proto.__tdRegistry.get(this.toolName) !== undefined ||
      (isMcpTool(this.toolName, this.toolDefinition?.label) && loadConfig().mcpToolCalls);
    if (!ownedByPatch) return undefined;
    // Adapter-rendered blocks bypass the stock MouseRegion wrappers: the patched render
    // never updates selfRenderHeight (edit is renderShell "self"), and default-shell child
    // heights no longer match our rendered lines. Finish unhandled left clicks ourselves,
    // mirroring the stock createResultRegion semantics.
    if (!this.result || event.type !== "click" || event.button !== "left") return undefined;
    this.setExpanded(!this.expanded);
    return { handled: true };
  };
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
    try {
      if (!loadConfig().bashAssessment || !loadSystemOneConfig().apiKey?.trim()) return;
      const command = event.input.command;
      if (typeof command !== "string" || !command.trim()) return;
      const cwd = "workdir" in event.input && typeof event.input.workdir === "string" ? event.input.workdir : ctx.cwd;
      assessments.request(event.toolCallId, (signal) => assessBashCommand(command, cwd, signal), ctx.signal);
    } catch (error) {
      logger.warn(`Bash assessment setup failed: ${String(error)}`);
    }
  });

  pi.on("session_shutdown", () => {
    isTui = false;
    assessments.dispose();
    tui = undefined;
  });

  pi.on("before_agent_start", () => {
    if (!isTui) return;
    refreshMcpTools(pi);
    patchToolExecutionRender(() => activeTheme, globalToolDisplayRegistry, getHeaderAnnotation);
  });
}
