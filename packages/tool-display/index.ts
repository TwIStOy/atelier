export {
  ToolCallDisplayComponent,
  ToolDisplayRegistry,
  type ToolCallDisplayOpts,
  formatToolArgs,
  formatGenericToolHeader,
  renderToolCall,
  defaultCollapsedRenderer,
  defaultExpandedRenderer,
  defaultGenericCollapsedRenderer,
  defaultGenericExpandedRenderer,
} from "./tool-call-display.ts";
export type { ContentRenderer, ToolDisplayAdapter } from "./types.ts";
export { prefixLine, wrapTextWithAnsi, spinnerGlyph } from "./format.ts";
export { askUserQuestionAdapter } from "./adapters/ask-user-question.ts";
export { bashAdapter } from "./adapters/bash.ts";
export { editAdapter } from "./adapters/edit.ts";
export { globAdapter } from "./adapters/glob.ts";
export { grepAdapter } from "./adapters/grep.ts";
export { lsAdapter } from "./adapters/ls.ts";
export { readAdapter } from "./adapters/read.ts";
export { writeAdapter } from "./adapters/write.ts";
export { globalToolDisplayRegistry } from "./registry.ts";

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { globalToolDisplayRegistry } from "./registry.ts";
import { renderToolCall } from "./tool-call-display.ts";

type ToolExecutionPatchThis = {
  hideComponent?: boolean;
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
  invalidate(): void;
};

const FALLBACK_THEME: Theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

function patchToolExecutionRender(
  getTheme: () => Theme,
  registry: typeof globalToolDisplayRegistry,
) {
  const proto: any = ToolExecutionComponent.prototype;
  proto.__tdGetTheme = getTheme;
  proto.__tdRegistry = registry;

  if (proto.__tdPatched) return;

  const originalSetExpanded = proto.setExpanded as (
    this: ToolExecutionPatchThis,
    expanded: boolean,
  ) => void;
  proto.setExpanded = function (
    this: ToolExecutionPatchThis,
    expanded: boolean,
  ) {
    originalSetExpanded.call(this, expanded);
    this.invalidate();
  };

  const originalRender = proto.render;
  proto.render = function (
    this: ToolExecutionPatchThis,
    width: number,
  ): string[] {
    if (this.hideComponent) return [];

    const reg = proto.__tdRegistry;
    const adapter = reg.get(this.toolName);
    const callR = this.getCallRenderer?.();
    const resultR = this.result ? this.getResultRenderer?.() : undefined;
    if (!adapter && (callR != null || resultR != null)) {
      return originalRender.call(this, width);
    }

    const def = this.toolDefinition ?? this.builtInToolDefinition;
    const getTextOutput = this.getTextOutput?.bind(this);
    const output = this.result ? getTextOutput?.() : undefined;

    const opts = {
      toolName: this.toolName,
      toolLabel: def?.label,
      toolDescription: def?.description,
      args: this.args,
      output,
      details: this.result?.details,
      expanded: this.expanded,
      isPartial: this.isPartial,
      isError: this.result?.isError ?? false,
      registry: reg,
    };

    const theme = proto.__tdGetTheme?.() ?? FALLBACK_THEME;
    const rendered = renderToolCall(opts, theme);
    return rendered.render(width);
  };
  proto.__tdPatched = true;
}

export default function (pi: ExtensionAPI) {
  let activeTheme: Theme = FALLBACK_THEME;

  patchToolExecutionRender(() => activeTheme, globalToolDisplayRegistry);

  pi.on("session_start", (_event, ctx) => {
    if (ctx.ui?.theme) {
      activeTheme = ctx.ui.theme;
    }
    patchToolExecutionRender(() => activeTheme, globalToolDisplayRegistry);
  });

  pi.on("before_agent_start", () => {
    patchToolExecutionRender(() => activeTheme, globalToolDisplayRegistry);
  });
}
