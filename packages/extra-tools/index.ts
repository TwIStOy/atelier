import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGlobTool } from "./glob/index.ts";
import { registerGrepTool } from "./grep/index.ts";

export default function (pi: ExtensionAPI) {
  registerGrepTool(pi);
  registerGlobTool(pi);
}
