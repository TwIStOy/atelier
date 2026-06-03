import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAskUserQuestionDemos } from "./demo.ts";
import { registerAskUserQuestionTool } from "./tool.ts";

export default function (pi: ExtensionAPI) {
  registerAskUserQuestionTool(pi);
  registerAskUserQuestionDemos(pi);
}
