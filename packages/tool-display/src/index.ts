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
import {
  componentRendersLines,
  findComponentContext,
  isExtensionDisabled,
  readRailTailSpacing,
} from "@htwang-contrib/common";
import { isAggregateToolName, renderAggregateLine } from "./aggregate.ts";
import { registerToolDisplayConfigItems } from "./config.ts";
import { globalToolDisplayRegistry } from "./registry.ts";
import { renderToolCall } from "./tool-call-display.ts";
import type { ToolDisplayAdapter } from "./types.ts";

type ToolExecutionPatchThis = {
  hideComponent?: boolean;
  __tdHovered?: boolean;
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

function isAggregateCandidate(component: unknown): component is ToolExecutionPatchThis {
  const tool = asToolExecution(component);
  return tool !== undefined && isAggregateToolName(tool.toolName) && !tool.expanded && !tool.hideComponent;
}

type AggregateGroupRole = { role: "member" } | { role: "leader"; members: ToolExecutionPatchThis[] };

function resolveAggregateRole(component: ToolExecutionPatchThis, width: number): AggregateGroupRole | undefined {
  if (!isAggregateCandidate(component)) return undefined;
  const context = findComponentContext((component as { ui?: unknown }).ui, component);
  if (!context) return undefined;
  const { siblings, index } = context;

  let followsAggregateSibling = false;
  for (let i = index - 1; i >= 0; i--) {
    const tool = asToolExecution(siblings[i]);
    if (tool) {
      if (tool.hideComponent) continue;
      if (isAggregateCandidate(tool)) followsAggregateSibling = true;
      break;
    }
    if (componentRendersLines(siblings[i], width)) break;
  }
  if (followsAggregateSibling) return { role: "member" };

  const members: ToolExecutionPatchThis[] = [component];
  for (let i = index + 1; i < siblings.length; i++) {
    const tool = asToolExecution(siblings[i]);
    if (tool) {
      if (tool.hideComponent) continue;
      if (!isAggregateCandidate(tool)) break;
      members.push(tool);
    } else if (componentRendersLines(siblings[i], width)) {
      break;
    }
  }
  if (members.length < 2) return undefined;
  return { role: "leader", members };
}

function aggregateMemberStates(members: ToolExecutionPatchThis[]) {
  return members.map((member) => ({
    toolName: member.toolName,
    isPartial: member.isPartial,
    isError: member.result?.isError === true,
  }));
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
    if (aggregateRole?.role === "member") return [];
    if (aggregateRole?.role === "leader") {
      const theme = proto.__tdGetTheme?.() ?? FALLBACK_THEME;
      const lines = renderAggregateLine(aggregateMemberStates(aggregateRole.members), theme, width);
      return applyGroupSpacing(lines, findPreviousVisibleOf(this, width), true);
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

    return applyGroupSpacing(lines, findPreviousVisibleOf(this, width), true);
  };

  const originalHandleMouse = proto.handleMouse as
    | ((this: ToolExecutionPatchThis, event: PatchedMouseEvent) => unknown)
    | undefined;
  proto.handleMouse = function (this: ToolExecutionPatchThis, event: PatchedMouseEvent) {
    if (event.type === "click" && resolveAggregateRole(this, event.width ?? 0) !== undefined) {
      return undefined;
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
