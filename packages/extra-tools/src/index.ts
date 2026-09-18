import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled, registerChildExtensionFactory } from "@htwang-contrib/common";
import { registerBashTool } from "./bash/index.ts";
import { registerGlobTool } from "./glob/index.ts";
import { registerGrepTool } from "./grep/index.ts";
import { registerLsTool } from "./ls/index.ts";

export default function extraTools(pi: ExtensionAPI) {
  if (isExtensionDisabled("extra-tools")) return;
  registerChildExtensionFactory("extra-tools", extraTools);
  registerBashTool(pi);
  registerGrepTool(pi);
  registerGlobTool(pi);
  registerLsTool(pi);
}
