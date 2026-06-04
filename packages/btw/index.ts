import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerBtw } from "./btw.ts";

export default function (pi: ExtensionAPI): void {
  registerBtw(pi);
}
