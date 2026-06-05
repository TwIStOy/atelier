import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSnippetCommand } from "./snippets.ts";

export default function (pi: ExtensionAPI): void {
  registerSnippetCommand(pi);
}
