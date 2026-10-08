import { fileURLToPath } from "node:url";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled, isStaleCtxError } from "@htwang-contrib/common";
import { Type } from "@sinclair/typebox";
import { parseGoalCommand } from "./goal/command.ts";
import { loadGoalConfig, registerGoalConfigItems, setCachedModelOptions } from "./goal/config.ts";
import {
  shouldQueueBudgetLimitedPrompt,
  shouldQueueGoalContinuationAfterAgentEnd,
  shouldQueueGoalContinuationWhenIdle,
} from "./goal/continuation.ts";
import { createContinuationGuard } from "./goal/continuation-guard.ts";
import { GoalAlreadyExistsError, GoalNotFoundError } from "./goal/errors.ts";
import { formatGoalForTool, formatGoalToolResponse } from "./goal/format.ts";
import { buildBudgetLimitedPrompt, buildContinuationPrompt } from "./goal/prompt.ts";
import { createRecoveryState, noteRecoveryError, type RecoveryState, resetRecovery } from "./goal/recovery.ts";
import {
  accountGoalUsage,
  clearGoal,
  createGoal,
  type GoalStoreRef,
  readGoal,
  reopenActiveInterval,
  updateGoal,
} from "./goal/store.ts";
import type { Goal, TokenUsageSnapshot } from "./goal/types.ts";
import { GOAL_WIDGET_KEY, GOAL_WIDGET_OPTIONS, makeGoalWidget } from "./goal/ui.ts";
import { validateObjective, validateTokenBudget } from "./goal/validation.ts";
import { verifyGoalCompletion } from "./goal/verify.ts";

const PROMPTS_DIR = fileURLToPath(new URL("../prompts", import.meta.url));

function getStoreRef(ctx: ExtensionContext): GoalStoreRef {
  const sessionDir = ctx.sessionManager.getSessionDir();
  const threadId = ctx.sessionManager.getSessionId();
  return { baseDir: sessionDir, threadId };
}

function extractAssistantUsage(messages: unknown[]): TokenUsageSnapshot {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    if (m.role !== "assistant") continue;
    const usage = (msg as unknown as AssistantMessage).usage;
    if (!usage) continue;
    input += usage.input;
    output += usage.output;
    cacheRead += usage.cacheRead;
    cacheWrite += usage.cacheWrite;
  }
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
  };
}

function lastAssistantStopReason(messages: unknown[]): { stopReason: string; errorMessage?: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Record<string, unknown>;
    if (m.role !== "assistant") continue;
    const stopReason = typeof m.stopReason === "string" ? (m.stopReason as string) : "stop";
    const errorMessage = typeof m.errorMessage === "string" ? (m.errorMessage as string) : undefined;
    return { stopReason, errorMessage };
  }
  return null;
}

export default function initGoal(pi: ExtensionAPI): void {
  if (isExtensionDisabled("goal")) return;
  let currentGoalForWidget: Goal | null = null;
  let widgetCtx: ExtensionContext | null = null;
  const recoveryState: RecoveryState = createRecoveryState();
  const continuationGuard = createContinuationGuard();
  let budgetPromptSentFor: string | null = null;

  function refreshGoalWidget(goal: Goal | null): void {
    currentGoalForWidget = goal;
    if (!widgetCtx?.hasUI) return;
    if (!goal) {
      widgetCtx.ui.setWidget(GOAL_WIDGET_KEY, undefined, GOAL_WIDGET_OPTIONS);
      return;
    }
    widgetCtx.ui.setWidget(
      GOAL_WIDGET_KEY,
      makeGoalWidget(() => currentGoalForWidget),
      GOAL_WIDGET_OPTIONS,
    );
  }

  function emitGoalUpdate(goal: Goal | null): void {
    pi.events.emit("goal:update", goal);
    refreshGoalWidget(goal);
  }

  function clearContinuationState(): void {
    continuationGuard.clear();
    budgetPromptSentFor = null;
  }

  function resetGoalRuntime(): void {
    resetRecovery(recoveryState);
    clearContinuationState();
  }

  function queueContinuation(goal: Goal): void {
    if (!continuationGuard.shouldQueue(goal.id)) return;
    continuationGuard.markQueued(goal.id);
    pi.sendMessage(
      {
        customType: "pi-goal-continuation",
        content: buildContinuationPrompt(goal),
        display: false,
        details: { goalId: goal.id },
      },
      { triggerTurn: true, deliverAs: "followUp" },
    );
  }

  function queueBudgetLimited(goal: Goal): void {
    if (budgetPromptSentFor === goal.id) return;
    budgetPromptSentFor = goal.id;
    pi.sendMessage(
      {
        customType: "pi-goal-budget-limit",
        content: buildBudgetLimitedPrompt(goal),
        display: false,
        details: { goalId: goal.id },
      },
      { triggerTurn: true, deliverAs: "followUp" },
    );
  }

  registerGoalConfigItems();

  // --- Resources ---

  pi.on("resources_discover", () => ({ promptPaths: [PROMPTS_DIR] }));

  // --- Events ---

  pi.on("session_start", (_event, ctx) => {
    const models = ctx.modelRegistry.getAvailable();
    setCachedModelOptions(
      models.map((m) => ({
        label: `${m.provider}/${m.id}`,
        value: `${m.provider}/${m.id}`,
      })),
    );
  });

  pi.on("session_start", async (event, ctx) => {
    widgetCtx = ctx;
    resetGoalRuntime();
    try {
      const ref = getStoreRef(ctx);
      const goal = readGoal(ref);
      if (!goal) return;

      refreshGoalWidget(goal);

      if (goal.status === "active") {
        const rebased = reopenActiveInterval(ref);
        const liveGoal = rebased ?? goal;

        if (shouldQueueGoalContinuationWhenIdle(liveGoal, ctx.isIdle(), ctx.hasPendingMessages())) {
          queueContinuation(liveGoal);
        }
      }

      if (event.reason === "resume" && goal.status === "paused" && ctx.hasUI) {
        const choice = await ctx.ui.select(`Goal is paused: "${goal.objective}". Resume it?`, [
          "Resume",
          "Keep paused",
        ]);
        if (choice === "Resume") {
          const updated = updateGoal(ref, { status: "active" });
          emitGoalUpdate(updated);
          ctx.ui.notify(`Goal resumed: ${updated.objective}`, "info");
        }
      }
    } catch (e) {
      if (isStaleCtxError(e)) return;
      throw e;
    }
  });

  pi.on("turn_start", () => {
    continuationGuard.clear();
  });

  pi.on("input", () => {
    resetRecovery(recoveryState);
  });

  pi.on("agent_end", (event, ctx) => {
    const usage = extractAssistantUsage(event.messages);

    try {
      const ref = getStoreRef(ctx);
      let goal: Goal | null = readGoal(ref);
      if (goal) {
        goal = accountGoalUsage(ref, usage, "agentEnd");
        emitGoalUpdate(goal);
      }

      const last = lastAssistantStopReason(event.messages);

      if (last?.stopReason === "error") {
        noteRecoveryError(recoveryState, last.errorMessage ?? "unknown provider error");
        const cfg = loadGoalConfig();
        const count = recoveryState.consecutiveErrors;
        if (goal && goal.status === "active" && count >= cfg.maxConsecutiveErrors) {
          const paused = updateGoal(ref, { status: "paused" });
          emitGoalUpdate(paused);
          resetRecovery(recoveryState);
          ctx.ui.notify(
            `Goal paused after ${count} consecutive errors. Last: ${last.errorMessage ?? "unknown"}. Use /goal resume to retry.`,
            "warning",
          );
          return;
        }
        ctx.ui.notify(
          `Goal hit a provider error (${count}/${cfg.maxConsecutiveErrors}): ${last.errorMessage ?? "unknown"}. Auto-continuation paused; the host may still retry.`,
          "warning",
        );
        return;
      }

      if (last?.stopReason === "aborted") {
        return;
      }

      resetRecovery(recoveryState);

      if (!goal) return;

      if (shouldQueueBudgetLimitedPrompt(goal)) {
        queueBudgetLimited(goal);
        return;
      }

      if (shouldQueueGoalContinuationAfterAgentEnd(goal, ctx.hasPendingMessages())) {
        queueContinuation(goal);
      }
    } catch (e) {
      if (isStaleCtxError(e)) return;
      // goal may have been cleared during the turn
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    widgetCtx = null;
    clearContinuationState();
    try {
      const ref = getStoreRef(ctx);
      const goal = accountGoalUsage(
        ref,
        { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        "shutdown",
      );
      emitGoalUpdate(goal);
    } catch (e) {
      if (isStaleCtxError(e)) return;
      // goal may have been cleared before shutdown
    }
  });

  // --- Command ---

  pi.registerCommand("goal", {
    description: "Set, inspect, pause, resume, or clear the persistent goal",
    handler: async (rawArgs, ctx) => {
      const ref = getStoreRef(ctx);
      const cmd = parseGoalCommand(rawArgs);

      switch (cmd.kind) {
        case "show": {
          const goal = readGoal(ref);
          if (!goal) {
            ctx.ui.notify("No active goal. Use /goal <objective> to set one.", "info");
            return;
          }
          ctx.ui.notify(formatGoalForTool(goal), "info");
          return;
        }

        case "setObjective": {
          const objective = validateObjective(cmd.objective);
          const existing = readGoal(ref);
          if (existing) {
            const choice = await ctx.ui.select("Goal already exists. Replace it?", ["Replace", "Cancel"]);
            if (choice !== "Replace") {
              ctx.ui.notify("Goal unchanged.", "info");
              return;
            }
            clearGoal(ref);
          }
          resetGoalRuntime();
          const goal = createGoal(ref, objective, null);
          ctx.ui.notify(`Goal set: ${goal.objective}`, "info");
          emitGoalUpdate(goal);
          if (shouldQueueGoalContinuationWhenIdle(goal, ctx.isIdle(), ctx.hasPendingMessages())) {
            queueContinuation(goal);
          }
          return;
        }

        case "setStatus": {
          const goal = readGoal(ref);
          if (!goal) {
            ctx.ui.notify("No goal to update.", "warning");
            return;
          }
          if (cmd.status === "paused" && goal.status !== "active") {
            ctx.ui.notify(`Goal is already ${goal.status}, cannot pause.`, "warning");
            return;
          }
          if (cmd.status === "active" && goal.status === "active") {
            ctx.ui.notify("Goal is already active.", "info");
            return;
          }
          const updated = updateGoal(ref, { status: cmd.status });
          const label = cmd.status === "paused" ? "paused" : "resumed";
          ctx.ui.notify(`Goal ${label}: ${updated.objective}`, "info");
          emitGoalUpdate(updated);
          if (cmd.status === "active") {
            resetGoalRuntime();
            if (shouldQueueGoalContinuationWhenIdle(updated, ctx.isIdle(), ctx.hasPendingMessages())) {
              queueContinuation(updated);
            }
          }
          return;
        }

        case "clear": {
          const goal = readGoal(ref);
          if (!goal) {
            ctx.ui.notify("No goal to clear.", "info");
            return;
          }
          clearGoal(ref);
          clearContinuationState();
          ctx.ui.notify("Goal cleared.", "info");
          emitGoalUpdate(null);
          return;
        }
      }
    },
  });

  // --- Tools ---

  pi.registerTool({
    name: "create_goal",
    label: "Create Goal",
    description:
      "Create a persistent goal for the current session. Only call this when the user explicitly asks to set a goal — do not infer or auto-create goals. The goal persists across turns and drives automatic continuation until completed.",
    parameters: Type.Object({
      objective: Type.String({
        description: "A clear description of the goal to accomplish.",
      }),
      token_budget: Type.Optional(
        Type.Number({
          description:
            "Optional token budget. The goal will be marked budget-limited when tokens used exceed this limit.",
        }),
      ),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const ref = getStoreRef(ctx);
      const objective = validateObjective(params.objective);
      const tokenBudget = validateTokenBudget(params.token_budget);

      try {
        const goal = createGoal(ref, objective, tokenBudget);
        resetGoalRuntime();
        emitGoalUpdate(goal);
        return {
          content: [
            {
              type: "text",
              text: `Goal created:\n${formatGoalForTool(goal)}`,
            },
          ],
          details: formatGoalToolResponse(goal),
        };
      } catch (err) {
        if (err instanceof GoalAlreadyExistsError) {
          return {
            content: [
              {
                type: "text",
                text: "A goal already exists for this session. Use update_goal to modify it, or ask the user to clear it with /goal clear first.",
              },
            ],
            details: { error: "goal_already_exists" },
          };
        }
        throw err;
      }
    },
  });

  pi.registerTool({
    name: "update_goal",
    label: "Update Goal",
    description:
      "Mark the current goal as complete. Before the goal is actually marked complete, an independent verification agent is launched in a fresh session to confirm the objective is fully satisfied (it runs the project build/tests and inspects the repo). If verification fails, the goal stays active and you must keep working. Only call this when you believe the objective is genuinely done.",
    parameters: Type.Object({
      status: Type.Literal("complete", {
        description: 'Mark the goal as complete. Must be "complete".',
      }),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const ref = getStoreRef(ctx);
      const existing = readGoal(ref);
      if (!existing) {
        return {
          content: [
            {
              type: "text",
              text: "No goal found for this session. Create one first with create_goal.",
            },
          ],
          details: { error: "goal_not_found" },
        };
      }

      const verification = await verifyGoalCompletion(ctx, existing, signal);
      if ("error" in verification) {
        return {
          content: [
            {
              type: "text",
              text: `Goal completion verification could not run: ${verification.message}. The goal was NOT marked complete — try again or continue working.`,
            },
          ],
          details: { error: "verification_failed" },
        };
      }
      if (!verification.complete) {
        return {
          content: [
            {
              type: "text",
              text: `Independent verification REJECTED completion. The objective is not fully satisfied yet — do NOT mark it complete. Keep working until every part is done.

Verifier findings:
${verification.reasoning}`,
            },
          ],
          details: { error: "verification_rejected" },
        };
      }

      try {
        const goal = updateGoal(ref, { status: params.status });
        clearContinuationState();
        emitGoalUpdate(goal);
        return {
          content: [
            {
              type: "text",
              text: `Goal verified and completed:\n${formatGoalForTool(goal)}\n\nVerifier summary:\n${verification.reasoning}`,
            },
          ],
          details: formatGoalToolResponse(goal),
        };
      } catch (err) {
        if (err instanceof GoalNotFoundError) {
          return {
            content: [
              {
                type: "text",
                text: "No goal found for this session. Create one first with create_goal.",
              },
            ],
            details: { error: "goal_not_found" },
          };
        }
        throw err;
      }
    },
  });

  pi.registerTool({
    name: "get_goal",
    label: "Get Goal",
    description: "Retrieve the current goal for this session, if any.",
    parameters: Type.Object({}),
    annotations: { readOnlyHint: true },
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const ref = getStoreRef(ctx);
      const goal = readGoal(ref);
      if (!goal) {
        return {
          content: [
            {
              type: "text",
              text: "No goal set for this session.",
            },
          ],
          details: { goal: null },
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(formatGoalToolResponse(goal), null, 2),
          },
        ],
        details: formatGoalToolResponse(goal),
      };
    },
  });
}
