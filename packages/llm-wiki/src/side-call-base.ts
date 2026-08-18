import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import toori from "@htwang-contrib/toori";

export const WIKI_SIDE_CALL_FACTORIES: ExtensionFactory[] = [toori];

export const WIKI_SIDE_CALL_BASE_TOOLS = ["read", "bash"];
