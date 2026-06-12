import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { Type } from "@sinclair/typebox";
import { isStaleCtxError } from "@htwang-contrib/common";
import {
  registerGoalConfigItems,
  setCachedModelOptions,
} from "./goal/config.ts";
import { parseGoalCommand } from "./goal/command.ts";
import {
  createGoal,
  readGoal,
  updateGoal,
  clearGoal,
  accountGoalUsage,
  type GoalStoreRef,
} from "./goal/store.ts";
import { validateObjective, validateTokenBudget } from "./goal/validation.ts";
import { formatGoalForTool, formatGoalToolResponse } from "./goal/format.ts";
import { GoalAlreadyExistsError, GoalNotFoundError } from "./goal/errors.ts";
import {
  shouldQueueGoalContinuationAfterAgentEnd,
  shouldQueueGoalContinuationWhenIdle,
  shouldQueueBudgetLimitedPrompt,
} from "./goal/continuation.ts";
import {
  buildContinuationPrompt,
  buildBudgetLimitedPrompt,
} from "./goal/prompt.ts";
import { verifyGoalCompletion } from "./goal/verify.ts";
import type { Goal, TokenUsageSnapshot } from "./goal/types.ts";
import {
  GOAL_WIDGET_KEY,
  GOAL_WIDGET_OPTIONS,
  renderGoalWidget,
} from "./goal/ui.ts";

function getStoreRef(ctx: ExtensionContext): GoalStoreRef {
  const sessionDir = ctx.sessionManager.getSessionDir();
  const threadId = ctx.sessionManager.getSessionId();
  return { baseDir: sessionDir, threadId };
}

type GoalAccounting = {
  goalId: string;
  measuredFromMilliseconds: number;
};

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

export default function initGoal(pi: ExtensionAPI): void {
  let agentTurnInProgress = false;
  let goalAccounting: GoalAccounting | null = null;
  let currentGoalForWidget: Goal | null = null;
  let widgetCtx: ExtensionContext | null = null;

  function refreshGoalWidget(goal: Goal | null): void {
    currentGoalForWidget = goal;
    if (!widgetCtx?.hasUI) return;
    if (!goal) {
      widgetCtx.ui.setWidget(GOAL_WIDGET_KEY, undefined, GOAL_WIDGET_OPTIONS);
      return;
    }
    widgetCtx.ui.setWidget(
      GOAL_WIDGET_KEY,
      (_tui, theme) => ({
        render(width: number): string[] {
          return renderGoalWidget(currentGoalForWidget, theme, width);
        },
        invalidate() {},
      }),
      GOAL_WIDGET_OPTIONS,
    );
  }

  function emitGoalUpdate(goal: Goal | null): void {
    pi.events.emit("goal:update", goal);
    refreshGoalWidget(goal);
  }

  function queueHiddenGoalPrompt(customType: string, content: string): void {
    pi.sendMessage(
      { customType, content, display: false },
      { triggerTurn: true, deliverAs: "followUp" },
    );
  }

  function startAccounting(goal: Goal): void {
    goalAccounting = {
      goalId: goal.id,
      measuredFromMilliseconds: Date.now(),
    };
  }

  function stopAccounting(): void {
    goalAccounting = null;
  }

  function finalizeAccounting(
    ctx: ExtensionContext,
    usage: TokenUsageSnapshot,
  ): void {
    if (!goalAccounting) return;
    const ref = getStoreRef(ctx);
    const elapsedMs = Date.now() - goalAccounting.measuredFromMilliseconds;
    const elapsedSeconds = elapsedMs / 1000;
    try {
      const goal = accountGoalUsage(ref, usage, elapsedSeconds, "shutdown");
      emitGoalUpdate(goal);
    } catch {
      // goal may have been cleared mid-turn
    }
    stopAccounting();
  }

  registerGoalConfigItems();

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
    try {
      const ref = getStoreRef(ctx);
      const goal = readGoal(ref);
      if (!goal) return;

      refreshGoalWidget(goal);

      if (goal.status === "active") {
        startAccounting(goal);

        if (
          shouldQueueGoalContinuationWhenIdle(
            goal,
            ctx.isIdle(),
            ctx.hasPendingMessages(),
          )
        ) {
          queueHiddenGoalPrompt(
            "pi-goal-continuation",
            buildContinuationPrompt(goal),
          );
        }
      }

      if (event.reason === "resume" && goal.status === "paused" && ctx.hasUI) {
        const choice = await ctx.ui.select(
          `Goal is paused: "${goal.objective}". Resume it?`,
          ["Resume", "Keep paused"],
        );
        if (choice === "Resume") {
          const updated = updateGoal(ref, { status: "active" });
          startAccounting(updated);
          emitGoalUpdate(updated);
          ctx.ui.notify(`Goal resumed: ${updated.objective}`, "info");
        }
      }
    } catch (e) {
      if (isStaleCtxError(e)) return;
      throw e;
    }
  });

  pi.on("agent_start", (_event, ctx) => {
    agentTurnInProgress = true;

    try {
      const ref = getStoreRef(ctx);
      const goal = readGoal(ref);
      if (goal && goal.status === "active") {
        startAccounting(goal);
      }
    } catch {
      // ignore
    }
  });

  pi.on("agent_end", (event, ctx) => {
    const usage = extractAssistantUsage(event.messages);

    if (goalAccounting) {
      const elapsedMs = Date.now() - goalAccounting.measuredFromMilliseconds;
      const elapsedSeconds = elapsedMs / 1000;

      try {
        const ref = getStoreRef(ctx);
        const goal = accountGoalUsage(ref, usage, elapsedSeconds, "agentEnd");

        emitGoalUpdate(goal);

        if (shouldQueueBudgetLimitedPrompt(goal)) {
          queueHiddenGoalPrompt(
            "pi-goal-budget-limit",
            buildBudgetLimitedPrompt(goal),
          );
        } else if (
          shouldQueueGoalContinuationAfterAgentEnd(
            goal,
            ctx.hasPendingMessages(),
          )
        ) {
          queueHiddenGoalPrompt(
            "pi-goal-continuation",
            buildContinuationPrompt(goal),
          );
        }
      } catch (e) {
        if (isStaleCtxError(e)) return;
        // goal may have been cleared during the turn
      }
    }

    agentTurnInProgress = false;
    stopAccounting();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    widgetCtx = null;
    if (goalAccounting) {
      finalizeAccounting(ctx, {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
      });
    }
    agentTurnInProgress = false;
    stopAccounting();
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
            ctx.ui.notify(
              "No active goal. Use /goal <objective> to set one.",
              "info",
            );
            return;
          }
          ctx.ui.notify(formatGoalForTool(goal), "info");
          return;
        }

        case "setObjective": {
          const objective = validateObjective(cmd.objective);
          const existing = readGoal(ref);
          if (existing) {
            const choice = await ctx.ui.select(
              "Goal already exists. Replace it?",
              ["Replace", "Cancel"],
            );
            if (choice !== "Replace") {
              ctx.ui.notify("Goal unchanged.", "info");
              return;
            }
            clearGoal(ref);
          }
          const goal = createGoal(ref, objective, null);
          if (agentTurnInProgress) {
            startAccounting(goal);
          }
          ctx.ui.notify(`Goal set: ${goal.objective}`, "info");
          emitGoalUpdate(goal);
          if (
            shouldQueueGoalContinuationWhenIdle(
              goal,
              ctx.isIdle(),
              ctx.hasPendingMessages(),
            )
          ) {
            queueHiddenGoalPrompt(
              "pi-goal-continuation",
              buildContinuationPrompt(goal),
            );
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
            ctx.ui.notify(
              `Goal is already ${goal.status}, cannot pause.`,
              "warning",
            );
            return;
          }
          if (cmd.status === "active" && goal.status === "active") {
            ctx.ui.notify("Goal is already active.", "info");
            return;
          }
          const updated = updateGoal(ref, { status: cmd.status });
          if (cmd.status === "active" && agentTurnInProgress) {
            startAccounting(updated);
          } else if (cmd.status === "paused") {
            stopAccounting();
          }
          const label = cmd.status === "paused" ? "paused" : "resumed";
          ctx.ui.notify(`Goal ${label}: ${updated.objective}`, "info");
          emitGoalUpdate(updated);
          if (
            cmd.status === "active" &&
            shouldQueueGoalContinuationWhenIdle(
              updated,
              ctx.isIdle(),
              ctx.hasPendingMessages(),
            )
          ) {
            queueHiddenGoalPrompt(
              "pi-goal-continuation",
              buildContinuationPrompt(updated),
            );
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
          stopAccounting();
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
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const ref = getStoreRef(ctx);
      const objective = validateObjective(params.objective);
      const tokenBudget = validateTokenBudget(params.token_budget);

      try {
        const goal = createGoal(ref, objective, tokenBudget);
        if (agentTurnInProgress) {
          startAccounting(goal);
        }
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
        stopAccounting();
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
