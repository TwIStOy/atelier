import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isExtensionDisabled } from "@htwang-contrib/common/extension-disable";
import { registerBtw } from "./btw.ts";

export default function (pi: ExtensionAPI): void {
  if (isExtensionDisabled("btw")) return;
  registerBtw(pi);
}
