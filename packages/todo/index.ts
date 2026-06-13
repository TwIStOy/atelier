import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isStaleCtxError } from "@htwang-contrib/common";
import { replayFromBranch } from "./state/replay.ts";
import { replaceState } from "./state/store.ts";
import { TOOL_NAME } from "./tool/types.ts";
import { registerTodosCommand, registerTodoTool } from "./todo.ts";
import { TodoOverlay } from "./todo-overlay.ts";

export default function (pi: ExtensionAPI) {
  let todoOverlay: TodoOverlay | undefined;

  registerTodoTool(pi);
  registerTodosCommand(pi);

  pi.on("session_start", async (_event, ctx) => {
    replaceState(replayFromBranch(ctx));
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
    if (event.toolName !== TOOL_NAME || event.isError) return;
    todoOverlay?.update();
  });

  pi.on("agent_start", async () => {
    todoOverlay?.hideCompletedTasksFromPreviousTurn();
  });
}
