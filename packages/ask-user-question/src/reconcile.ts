import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ASK_USER_QUESTION_TOOL_NAME } from "./tool.ts";

/**
 * Strip-or-restore the tool to match `ctx.hasUI` so it never reaches the LLM's
 * tool list in non-interactive runs (print/json modes report hasUI:false).
 * Reads the active set itself and is idempotent: when the tool is already in the
 * right state it leaves the active set (and sibling tools) untouched.
 */
export function reconcileAskUserQuestionTool(pi: ExtensionAPI, ctx: ExtensionContext): void {
  const active = pi.getActiveTools();
  const hasTool = active.includes(ASK_USER_QUESTION_TOOL_NAME);
  if (!ctx.hasUI && hasTool) {
    pi.setActiveTools(active.filter((n) => n !== ASK_USER_QUESTION_TOOL_NAME));
  } else if (ctx.hasUI && !hasTool) {
    pi.setActiveTools([...active, ASK_USER_QUESTION_TOOL_NAME]);
  }
}

/**
 * Attach the reconciler to `before_agent_start` so the active set is fixed up
 * before each turn's tool-list snapshot is read. The `!hasUI` guard inside
 * execute() stays as a one-turn backstop.
 */
export function registerAskUserQuestionReconciler(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (_event, ctx) => reconcileAskUserQuestionTool(pi, ctx));
}
