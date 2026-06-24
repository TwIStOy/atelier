import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { Key, matchesKey } from "@earendil-works/pi-tui";
import { buildContextUsageDetails, renderContextUsageMessage } from "./context-usage.ts";

const CONTEXT_USAGE_WIDGET_KEY = "pi-extensions.context-usage";

const INSTALL_GUARD = Symbol.for("pi-extensions.context-usage.installed");

const WIDGET_OPTIONS = { placement: "belowEditor" as const };

type BelowState = {
  visible: boolean;
  unsubscribeInput?: () => void;
};

const belowStateByCtx = new WeakMap<ExtensionContext, BelowState>();

function ensureBelowState(ctx: ExtensionContext): BelowState | undefined {
  if (!ctx.hasUI) return undefined;
  let state = belowStateByCtx.get(ctx);
  if (state) return state;
  state = { visible: false };
  state.unsubscribeInput = ctx.ui.onTerminalInput((data) => {
    if (!state!.visible) return undefined;
    if (matchesKey(data, Key.escape)) {
      ctx.ui.setWidget(CONTEXT_USAGE_WIDGET_KEY, undefined, WIDGET_OPTIONS);
      state!.visible = false;
      return { consume: true };
    }
    return undefined;
  });
  belowStateByCtx.set(ctx, state);
  return state;
}

export default function initContextUsage(pi: ExtensionAPI): void {
  const guard = pi as unknown as Record<symbol, boolean>;
  if (guard[INSTALL_GUARD]) return;
  guard[INSTALL_GUARD] = true;

  let latestSystemPromptOptions: unknown;

  pi.on("before_agent_start", (event: { systemPromptOptions?: unknown }) => {
    latestSystemPromptOptions = event?.systemPromptOptions;
  });

  pi.on("session_start", (_event, ctx) => {
    ensureBelowState(ctx);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    const state = belowStateByCtx.get(ctx);
    if (ctx.hasUI && state?.visible) {
      ctx.ui.setWidget(CONTEXT_USAGE_WIDGET_KEY, undefined, WIDGET_OPTIONS);
    }
    state?.unsubscribeInput?.();
    belowStateByCtx.delete(ctx);
  });

  pi.registerCommand("context", {
    description: "Show estimated context-window usage in the below-editor widget (Esc clears).",
    handler: async (_args, ctx) => {
      const state = ensureBelowState(ctx);
      if (!state) {
        ctx.ui.notify("Context usage needs an interactive terminal session.", "warning");
        return;
      }
      const details = buildContextUsageDetails(pi, ctx, latestSystemPromptOptions);
      if (!details) {
        ctx.ui.notify("Context usage is not available yet (no token estimate from the session).", "warning");
        return;
      }
      ctx.ui.setWidget(
        CONTEXT_USAGE_WIDGET_KEY,
        (_tui: TUI, theme: Theme) => {
          const renderer = renderContextUsageMessage({ details }, {}, theme);
          return {
            invalidate() {
              renderer.invalidate();
            },
            render(width: number) {
              return renderer.render(width);
            },
          };
        },
        WIDGET_OPTIONS,
      );
      state.visible = true;
    },
  });
}
