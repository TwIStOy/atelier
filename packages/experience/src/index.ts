import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerDoubleEscape } from "./double-escape/index.ts";
import { registerHideModels } from "./hide-models/index.ts";

export default function (pi: ExtensionAPI): void {
  registerHideModels(pi);
  registerDoubleEscape(pi);
}
