import type { ModelPromptRule } from "./index.ts";

export const kimiK3Rule: ModelPromptRule = {
  name: "kimi-k3",
  pattern: /kimi-k3/,
  prompt:
    "**NEVER** write Python scripts (or scripts in any other language) to modify source code. Always use the `edit` tool directly to change files.",
};
