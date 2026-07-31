import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled } from "@htwang-contrib/common";
import { registerGlobTool } from "./glob/index.ts";
import { registerGrepTool } from "./grep/index.ts";
import { registerLsTool } from "./ls/index.ts";

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled("extra-tools")) return;
  registerGrepTool(pi);
  registerGlobTool(pi);
  registerLsTool(pi);
}
