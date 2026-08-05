import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled } from "@htwang-contrib/common";
import { registerAskUserQuestionReconciler } from "./reconcile.ts";
import { registerAskUserQuestionTool } from "./tool.ts";

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled("ask-user-question")) return;
  registerAskUserQuestionTool(pi);
  registerAskUserQuestionReconciler(pi);
}
