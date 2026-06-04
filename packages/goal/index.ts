import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { parseGoalCommand, goalCommandUsage } from "./goal/command.ts";
import { formatGoalForTool } from "./goal/format.ts";
import {
  clearGoal,
  createGoal,
  readGoal,
  updateGoal,
  type GoalStoreRef,
} from "./goal/store.ts";

function resolveGoalStoreRef(ctx: ExtensionCommandContext): GoalStoreRef {
  return {
    baseDir: ctx.sessionManager.getSessionDir(),
    threadId: ctx.sessionManager.getSessionId(),
  };
}

function notifyInfo(ctx: ExtensionCommandContext, message: string): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, "info");
  }
}

function notifyWarning(ctx: ExtensionCommandContext, message: string): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, "warning");
  }
}

async function shouldReplaceExistingGoal(
  ctx: ExtensionCommandContext,
): Promise<boolean> {
  if (!ctx.hasUI) return true;
  const picked = await ctx.ui.select("Goal already exists. Replace it?", [
    "Replace",
    "Cancel",
  ]);
  return picked === "Replace";
}

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("goal", {
    description: "Set, inspect, pause, resume, or clear the persistent goal",
    handler: async (rawArgs, ctx) => {
      const ref = resolveGoalStoreRef(ctx);
      const command = parseGoalCommand(rawArgs);

      try {
        if (command.kind === "show") {
          const goal = await readGoal(ref);
          notifyInfo(ctx, goal ? formatGoalForTool(goal) : goalCommandUsage());
          return;
        }

        if (command.kind === "setObjective") {
          const existing = await readGoal(ref);
          if (existing) {
            const confirmed = await shouldReplaceExistingGoal(ctx);
            if (!confirmed) return;
            const updated = await updateGoal(ref, {
              objective: command.objective,
              status: "active",
            });
            notifyInfo(ctx, `Goal updated: ${updated.objective}`);
            return;
          }

          const created = await createGoal(ref, command.objective);
          notifyInfo(ctx, `Goal created: ${created.objective}`);
          return;
        }

        if (command.kind === "setStatus") {
          const existing = await readGoal(ref);
          if (!existing) {
            notifyWarning(ctx, `No goal found. ${goalCommandUsage()}`);
            return;
          }
          const next = await updateGoal(ref, { status: command.status });
          notifyInfo(ctx, `Goal status: ${next.status}`);
          return;
        }

        await clearGoal(ref);
        notifyInfo(ctx, "Goal cleared.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notifyWarning(ctx, `Goal command failed: ${message}`);
      }
    },
  });
}
