export {
  ToolCallDisplayComponent,
  ToolDisplayRegistry,
  type ToolCallDisplayOpts,
  formatToolArgs,
  renderToolCall,
  defaultCollapsedRenderer,
  defaultExpandedRenderer,
} from "./tool-call-display.ts";
export type { ContentRenderer, ToolDisplayAdapter } from "./types.ts";
export { prefixLine, wrapTextWithAnsi } from "./format.ts";
export { readAdapter } from "./adapters/read.ts";
export { globalToolDisplayRegistry } from "./registry.ts";

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { globalToolDisplayRegistry } from "./registry.ts";
import { renderToolCall } from "./tool-call-display.ts";

const FALLBACK_THEME: Theme = {
  fg: (_color: string, text: string) => text,
} as Theme;

function patchToolExecutionRender(getTheme: () => Theme) {
  const proto: any = ToolExecutionComponent.prototype;
  proto.__tdGetTheme = getTheme;

  if (proto.__tdPatched) return;

  const originalRender = proto.render;
  proto.render = function (width: number): string[] {
    if (this.hideComponent) return [];

    const adapter = globalToolDisplayRegistry.get(this.toolName);
    if (!adapter) return originalRender.call(this, width);

    const getTextOutput = this.getTextOutput?.bind(this);
    const output = this.result ? getTextOutput?.() : undefined;

    const opts = {
      toolName: this.toolName,
      args: this.args,
      output,
      expanded: this.expanded,
      isPartial: this.isPartial,
      isError: this.result?.isError ?? false,
      registry: globalToolDisplayRegistry,
    };

    const theme = proto.__tdGetTheme?.() ?? FALLBACK_THEME;
    const rendered = renderToolCall(opts, theme);
    return rendered.render(width);
  };
  proto.__tdPatched = true;
}

export default function (pi: ExtensionAPI) {
  let activeTheme: Theme = FALLBACK_THEME;

  patchToolExecutionRender(() => activeTheme);

  pi.on("session_start", (_event, ctx) => {
    if (ctx.ui?.theme) {
      activeTheme = ctx.ui.theme;
    }
  });
}
