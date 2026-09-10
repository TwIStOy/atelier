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
import { Container, Editor } from "@earendil-works/pi-tui";
import { isExtensionDisabled } from "@htwang-contrib/common";
import {
  aggregateSubrowBodyWidth,
  isAggregateToolName,
  renderAggregateLine,
  renderAggregateSubrowLine,
} from "./aggregate.ts";
import { registerToolDisplayConfigItems } from "./config.ts";
import { globalToolDisplayRegistry } from "./registry.ts";
import { formatGenericToolHeader, renderToolCall, type ToolDisplayRegistry, toolBullet } from "./tool-call-display.ts";
import type { ToolDisplayAdapter } from "./types.ts";

type ToolExecutionPatchThis = {
  hideComponent?: boolean;
  __tdHovered?: boolean;
  __tdAggregateLeadingBlank?: boolean;
  toolName: string;
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
  const context = findSiblingContext(root, target);
  if (!context) return undefined;
  const { siblings, index } = context;
  for (let i = index - 1; i >= 0; i--) {
    const candidate = siblings[i] as { render?: (w: number) => string[] };
    if (typeof candidate?.render !== "function") continue;
    if (candidate.render(width).length > 0) return candidate;
  }
  return null;
}

function findPreviousVisibleOf(component: ToolExecutionPatchThis, width: number): unknown {
  const ui = (component as { ui?: unknown }).ui;
  if (!ui) return undefined;
  return findPreviousVisibleSibling(ui, component, width);
}

interface SiblingContext {
  siblings: unknown[];
  index: number;
}

function findSiblingContext(root: unknown, target: object): SiblingContext | undefined {
  if (!root || typeof root !== "object") return undefined;
  const children = (root as { children?: unknown }).children;
  if (!Array.isArray(children)) return undefined;
  const index = children.indexOf(target);
  if (index >= 0) return { siblings: children, index };
  for (const child of children) {
    const found = findSiblingContext(child, target);
    if (found) return found;
  }
  return undefined;
}

function siblingRendersLines(sibling: unknown, width: number): boolean {
  if (typeof width !== "number" || width <= 0) return true;
  if (!sibling || typeof sibling !== "object") return false;
  const render = (sibling as { render?: (w: number) => string[] }).render;
  if (typeof render !== "function") return false;
  return render.call(sibling, width).length > 0;
}

function asToolExecution(component: unknown): ToolExecutionPatchThis | undefined {
  return component instanceof ToolExecutionComponent ? (component as unknown as ToolExecutionPatchThis) : undefined;
}

interface AggregateGroupResolution {
  role: "leader" | "member";
  leader: ToolExecutionPatchThis;
  members: ToolExecutionPatchThis[];
  groupExpanded: boolean;
}

const aggregateGroupState = new WeakMap<ToolExecutionPatchThis, { expanded: boolean }>();

function isAggregateToolComponent(component: unknown): component is ToolExecutionPatchThis {
  const tool = asToolExecution(component);
  return tool !== undefined && isAggregateToolName(tool.toolName) && !tool.hideComponent;
}

// A sequence member can head a group when it is collapsed, or when it already leads an
// expanded group and was individually expanded through its own subrow.
function isGroupHeadCandidate(tool: ToolExecutionPatchThis): boolean {
  return !tool.expanded || aggregateGroupState.get(tool)?.expanded === true;
}

function aggregateSequenceHead(siblings: unknown[], index: number, width: number): ToolExecutionPatchThis | undefined {
  const self = siblings[index] as ToolExecutionPatchThis;
  let head: ToolExecutionPatchThis | undefined = isGroupHeadCandidate(self) ? self : undefined;
  for (let i = index - 1; i >= 0; i--) {
    const tool = asToolExecution(siblings[i]);
    if (tool) {
      if (tool.hideComponent) continue;
      if (!isAggregateToolName(tool.toolName)) break;
      if (isGroupHeadCandidate(tool)) head = tool;
      continue;
    }
    if (siblingRendersLines(siblings[i], width)) break;
  }
  return head;
}

function candidateRunHead(siblings: unknown[], index: number, width: number): ToolExecutionPatchThis {
  let head = siblings[index] as ToolExecutionPatchThis;
  for (let i = index - 1; i >= 0; i--) {
    const tool = asToolExecution(siblings[i]);
    if (tool) {
      if (tool.hideComponent) continue;
      if (!isAggregateToolName(tool.toolName) || tool.expanded) break;
      head = tool;
      continue;
    }
    if (siblingRendersLines(siblings[i], width)) break;
  }
  return head;
}

function collectAggregateSequence(
  siblings: unknown[],
  startIndex: number,
  width: number,
  includeExpanded: boolean,
): ToolExecutionPatchThis[] {
  const members: ToolExecutionPatchThis[] = [];
  for (let i = startIndex; i < siblings.length; i++) {
    const tool = asToolExecution(siblings[i]);
    if (tool) {
      if (tool.hideComponent) continue;
      if (!isAggregateToolName(tool.toolName)) break;
      if (!includeExpanded && tool.expanded) break;
      members.push(tool);
    } else if (siblingRendersLines(siblings[i], width)) {
      break;
    }
  }
  return members;
}

// The surrounding aggregate sequence is re-derived on every call so streaming arrivals and
// session replay resolve identically. An expanded group keyed on its leader absorbs members
// even while they are individually expanded; without group state, expanded widgets break
// candidate runs exactly as before.
function resolveAggregateRole(component: ToolExecutionPatchThis, width: number): AggregateGroupResolution | undefined {
  if (!isAggregateToolComponent(component)) return undefined;
  const context = findSiblingContext((component as { ui?: unknown }).ui, component);
  if (!context) return undefined;
  const { siblings, index } = context;

  const head = aggregateSequenceHead(siblings, index, width);
  if (head && aggregateGroupState.get(head)?.expanded) {
    const members = collectAggregateSequence(siblings, siblings.indexOf(head), width, true);
    if (members.length >= 2) {
      return { role: component === head ? "leader" : "member", leader: head, members, groupExpanded: true };
    }
  }

  if (component.expanded) return undefined;
  const runHead = candidateRunHead(siblings, index, width);
  const members = collectAggregateSequence(siblings, siblings.indexOf(runHead), width, false);
  if (members.length < 2) return undefined;
  return { role: component === runHead ? "leader" : "member", leader: runHead, members, groupExpanded: false };
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
  if (previous instanceof ToolExecutionComponent) {
    return lines.length > 0 && lines[0].trim() === "" ? lines.slice(1) : lines;
  }
  if (ensureLeadingBlank && (lines.length === 0 || lines[0].trim() !== "")) {
    return ["", ...lines];
  }
  return lines;
}

function patchToolExecutionRender(getTheme: () => Theme, registry: typeof globalToolDisplayRegistry) {
  const proto: any = ToolExecutionComponent.prototype;
  proto.__tdGetTheme = getTheme;
  proto.__tdRegistry = registry;

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

    const aggregateRole = resolveAggregateRole(this, width);
    if (aggregateRole?.role === "member") {
      if (!aggregateRole.groupExpanded) return [];
      if (!this.expanded) {
        const theme = proto.__tdGetTheme?.() ?? FALLBACK_THEME;
        return [renderAggregateMemberSubrow(this, theme, width, proto.__tdRegistry)];
      }
    }

    let aggregatePrefix: string[] = [];
    if (aggregateRole?.role === "leader") {
      const theme = proto.__tdGetTheme?.() ?? FALLBACK_THEME;
      const lines = renderAggregateLine(
        aggregateMemberStates(aggregateRole.members),
        theme,
        width,
        Date.now(),
        aggregateRole.groupExpanded,
      );
      const previous = findPreviousVisibleOf(this, width);
      // Click routing must match the layout the TUI routed the event against, so the
      // separator state is captured at render time instead of being recomputed from the
      // mouse event's width.
      this.__tdAggregateLeadingBlank = !(previous instanceof ToolExecutionComponent);
      if (!aggregateRole.groupExpanded) {
        return applyGroupSpacing(lines, previous, true);
      }
      if (!this.expanded) {
        lines.push(renderAggregateMemberSubrow(this, theme, width, proto.__tdRegistry));
        return applyGroupSpacing(lines, previous, true);
      }
      aggregatePrefix = lines;
    }

    const reg = proto.__tdRegistry;
    const adapter = reg.get(this.toolName);
    const callR = this.getCallRenderer?.();
    const resultR = this.result ? this.getResultRenderer?.() : undefined;
    if (!adapter && (callR != null || resultR != null)) {
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
    };

    const theme = proto.__tdGetTheme?.() ?? FALLBACK_THEME;
    const rendered = renderToolCall(opts, theme);
    const lines = rendered.render(width);

    return applyGroupSpacing([...aggregatePrefix, ...lines], findPreviousVisibleOf(this, width), true);
  };

  const originalHandleMouse = proto.handleMouse as
    | ((this: ToolExecutionPatchThis, event: PatchedMouseEvent) => unknown)
    | undefined;

  function toggleAggregateGroup(aggregate: AggregateGroupResolution): void {
    if (aggregateGroupState.get(aggregate.leader)?.expanded) {
      aggregateGroupState.delete(aggregate.leader);
      for (const member of aggregate.members) {
        if (member.expanded) member.setExpanded(false);
      }
      return;
    }
    aggregateGroupState.set(aggregate.leader, { expanded: true });
  }

  function handleAggregateClick(
    component: ToolExecutionPatchThis,
    aggregate: AggregateGroupResolution,
    event: PatchedMouseEvent,
  ): { handled: true } | undefined {
    if (aggregate.role === "leader") {
      const summaryY = component.__tdAggregateLeadingBlank === true ? 1 : 0;
      const y = event.y ?? 0;
      if (aggregate.groupExpanded && y > summaryY) {
        if (!component.expanded && !component.result) return undefined;
        component.setExpanded(!component.expanded);
        return { handled: true };
      }
      if (y < summaryY) return undefined;
      toggleAggregateGroup(aggregate);
      return { handled: true };
    }
    if (!aggregate.groupExpanded) return undefined;
    if (!component.expanded && !component.result) return undefined;
    component.setExpanded(!component.expanded);
    return { handled: true };
  }

  proto.handleMouse = function (this: ToolExecutionPatchThis, event: PatchedMouseEvent) {
    if (event.type === "click") {
      const aggregateRole = resolveAggregateRole(this, event.width ?? 0);
      if (aggregateRole) {
        if (event.button !== "left") return undefined;
        return handleAggregateClick(this, aggregateRole, event);
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
    if (!proto.__tdRegistry.get(this.toolName)) return undefined;
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

  pi.events.on("tool-display:register", (data) => {
    const { toolName, adapter } = data as {
      toolName: string;
      adapter: ToolDisplayAdapter;
    };
    globalToolDisplayRegistry.register(toolName, adapter);
  });

  pi.events.emit("tool-display:ready", undefined);

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    isTui = true;
    registerToolDisplayConfigItems();
    if (ctx.ui?.theme) {
      activeTheme = ctx.ui.theme;
    }
    patchToolExecutionRender(() => activeTheme, globalToolDisplayRegistry);
  });

  pi.on("before_agent_start", () => {
    if (!isTui) return;
    patchToolExecutionRender(() => activeTheme, globalToolDisplayRegistry);
  });
}
