import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import inferenceV2SelfHost from "@htwang-contrib/inference-v2-self-host";

export const WIKI_SIDE_CALL_FACTORIES: ExtensionFactory[] = [inferenceV2SelfHost];

export const WIKI_SIDE_CALL_BASE_TOOLS = ["read", "bash"];
