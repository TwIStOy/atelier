import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerLogFileSizeWarning } from "./log.ts";

export default function logWarningExtension(pi: ExtensionAPI): void {
  registerLogFileSizeWarning(pi);
}
