import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled, isStaleCtxError } from "@htwang-contrib/common";
import { loadConfig, registerConfig } from "./config.ts";
import {
  createReminderCadence,
  drainReminderForContext,
  evaluateToolResult,
  onTurnStart,
  type ReminderCadenceState,
  resetReminderCadence,
} from "./reminder/cadence.ts";
import { buildReminderMessage } from "./reminder/message.ts";
import { replayFromBranch } from "./state/replay.ts";
import { selectVisibleTasks } from "./state/selectors.ts";
import { getState, replaceState } from "./state/store.ts";
import { registerTodosCommand, registerTodoTools } from "./todo.ts";
import { TodoOverlay } from "./todo-overlay.ts";
import { isTodoToolName } from "./tool/types.ts";

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled("todo")) return;
  let todoOverlay: TodoOverlay | undefined;
  const cadence: ReminderCadenceState = createReminderCadence();

  registerTodoTools(pi);
  registerTodosCommand(pi);
  registerConfig();

  pi.on("session_start", async (_event, ctx) => {
    replaceState(replayFromBranch(ctx));
    resetReminderCadence(cadence);
    if (ctx.hasUI) {
      todoOverlay ??= new TodoOverlay();
      todoOverlay.setUICtx(ctx.ui);
      todoOverlay.resetCompletedDisplayState();
      todoOverlay.update();
    }
  });

  pi.on("session_compact", async (_event, ctx) => {
    try {
      replaceState(replayFromBranch(ctx));
    } catch (e) {
      if (!isStaleCtxError(e)) throw e;
    }
    todoOverlay?.resetCompletedDisplayState();
    todoOverlay?.update();
  });

  pi.on("session_tree", async (_event, ctx) => {
    try {
      replaceState(replayFromBranch(ctx));
    } catch (e) {
      if (!isStaleCtxError(e)) throw e;
    }
    todoOverlay?.resetCompletedDisplayState();
    todoOverlay?.update();
  });

  pi.on("session_shutdown", async () => {
    todoOverlay?.dispose();
    todoOverlay = undefined;
  });

  pi.on("tool_execution_end", async (event) => {
    if (!isTodoToolName(event.toolName) || event.isError) return;
    todoOverlay?.update();
  });

  pi.on("agent_start", async () => {
    todoOverlay?.hideCompletedTasksFromPreviousTurn();
  });

  pi.on("turn_start", async () => {
    onTurnStart(cadence);
  });

  pi.on("tool_result", async (event) => {
    const config = loadConfig();
    if (!config.reminderEnabled) return;
    const isTodoTool = isTodoToolName(event.toolName);
    if (!isTodoTool && cadence.currentTurn - cadence.lastTodoToolUseTurn < config.reminderInterval) return;
    if (!isTodoTool && cadence.reminderDue) return;
    const hasVisibleTasks = isTodoTool ? false : selectVisibleTasks(getState()).length > 0;
    evaluateToolResult(cadence, isTodoTool, hasVisibleTasks, config.reminderInterval);
  });

  pi.on("context", async (event) => {
    if (!drainReminderForContext(cadence)) return;
    return {
      messages: [
        ...event.messages,
        {
          role: "user" as const,
          content: buildReminderMessage(selectVisibleTasks(getState())),
          timestamp: Date.now(),
        },
      ],
    };
  });
}
