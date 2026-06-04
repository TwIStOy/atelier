import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { parseGoalCommand } from "./goal/command.ts";
import {
  createGoal,
  readGoal,
  updateGoal,
  clearGoal,
  type GoalStoreRef,
} from "./goal/store.ts";
import { validateObjective, validateTokenBudget } from "./goal/validation.ts";
import { formatGoalForTool, formatGoalToolResponse } from "./goal/format.ts";
import { GoalAlreadyExistsError, GoalNotFoundError } from "./goal/errors.ts";

function getStoreRef(ctx: ExtensionContext): GoalStoreRef {
  const sessionDir = ctx.sessionManager.getSessionDir();
  const threadId = ctx.sessionManager.getSessionId();
  return { baseDir: sessionDir, threadId };
}

export default function initGoal(pi: ExtensionAPI): void {
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
          ctx.ui.notify(`Goal set: ${goal.objective}`, "info");
          pi.events.emit("goal:update", goal);
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
          const label = cmd.status === "paused" ? "paused" : "resumed";
          ctx.ui.notify(`Goal ${label}: ${updated.objective}`, "info");
          pi.events.emit("goal:update", updated);
          return;
        }

        case "clear": {
          const goal = readGoal(ref);
          if (!goal) {
            ctx.ui.notify("No goal to clear.", "info");
            return;
          }
          clearGoal(ref);
          ctx.ui.notify("Goal cleared.", "info");
          pi.events.emit("goal:update", null);
          return;
        }
      }
    },
  });

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
        pi.events.emit("goal:update", goal);
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
      "Update the current goal. Currently only supports marking the goal as complete. Before marking complete, verify ALL of the following: (1) the objective has been fully addressed, (2) all code changes compile/pass tests, (3) no remaining edge cases or errors. Do NOT mark complete if any work remains.",
    parameters: Type.Object({
      status: Type.Literal("complete", {
        description: 'Mark the goal as complete. Must be "complete".',
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const ref = getStoreRef(ctx);
      try {
        const goal = updateGoal(ref, { status: params.status });
        pi.events.emit("goal:update", goal);
        return {
          content: [
            {
              type: "text",
              text: `Goal completed:\n${formatGoalForTool(goal)}`,
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
