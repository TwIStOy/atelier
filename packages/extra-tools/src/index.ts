import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGlobTool } from "./glob/index.ts";
import { registerGrepTool } from "./grep/index.ts";
import { registerLsTool } from "./ls/index.ts";

export default function (pi: ExtensionAPI) {
  registerGrepTool(pi);
  registerGlobTool(pi);
  registerLsTool(pi);
}
