import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled } from "@htwang-contrib/common";
import { registerDoubleEscape } from "./double-escape/index.ts";
import { registerHideModels } from "./hide-models/index.ts";

export default function (pi: ExtensionAPI): void {
  if (isExtensionDisabled("experience")) return;
  registerHideModels(pi);
  registerDoubleEscape(pi);
}
