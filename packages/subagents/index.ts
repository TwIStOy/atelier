import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  registerSubagentStatusTool,
  registerSubagentTool,
} from "./subagent-tool.ts";

export default function (pi: ExtensionAPI) {
  registerSubagentTool(pi);
  registerSubagentStatusTool(pi);
}
