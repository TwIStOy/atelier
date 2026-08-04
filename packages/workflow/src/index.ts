import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled } from "@htwang-contrib/common";
import { registerSavedWorkflowCommands, registerWorkflowsCommand } from "./commands.ts";
import { registerWorkflowConfigItems } from "./config.ts";
import { registerWorkflowTool } from "./tool.ts";

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled("workflow")) return;
  registerWorkflowConfigItems();
  registerWorkflowTool(pi);
  registerWorkflowsCommand(pi);

  pi.on("session_start", (_event, ctx) => {
    registerSavedWorkflowCommands(pi, ctx.cwd);
  });
}
