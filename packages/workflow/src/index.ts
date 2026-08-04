import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled } from "@htwang-contrib/common";
import { registerWorkflowConfigItems } from "./config.ts";
import { registerWorkflowTool } from "./tool.ts";

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled("workflow")) return;
  registerWorkflowConfigItems();
  registerWorkflowTool(pi);
}
