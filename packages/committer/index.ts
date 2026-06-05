import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleCommit } from "./commit.ts";
import { selectModel } from "./model-select.ts";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("commit", {
    description:
      "Generate a conventional commit from staged/unstaged changes using a side-call to an LLM.",
    async handler(args, ctx) {
      await handleCommit(pi, args, ctx);
    },
  });

  pi.registerCommand("commit-model", {
    description: "Select which model to use for commit message generation.",
    async handler(_args, ctx) {
      if (!ctx.hasUI) {
        ctx.ui.notify(
          "/commit-model requires an interactive terminal.",
          "warning",
        );
        return;
      }
      await selectModel(ctx);
    },
  });
}
