import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Register commands that only work in the interactive TUI.
 *
 * Extension factories run before the runner's mode is bound (ctx.mode is
 * still the "print" default there), so mode-gated registration must be
 * deferred to session_start, which fires after the real mode is bound.
 */
export function registerTuiCommands(pi: ExtensionAPI, register: (pi: ExtensionAPI) => void): void {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode === "tui") register(pi);
  });
}
