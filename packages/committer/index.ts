import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerConfigItems } from "@htwang-contrib/common";
import { handleCommit } from "./commit.ts";
import { selectModel } from "./model-select.ts";
import {
  MAX_DIFF_LENGTH,
  MAX_DIFF_LENGTH_SINGLE,
  MAX_GROUPING_RETRIES,
} from "./prompt.ts";

let cachedModels: Array<{ label: string; value: string }> = [];

export function setCachedModels(
  models: Array<{ label: string; value: string }>,
): void {
  cachedModels = models;
}

export default function (pi: ExtensionAPI): void {
  registerConfigItems("committer", [
    {
      key: "model",
      type: "select",
      label: "Commit Model",
      defaultValue: "",
      description:
        "Model used for commit message generation. Use /commit-model for quick switching.",
      extensionLabel: "Committer",
      order: 0,
      options: () => [{ label: "(default)", value: "" }, ...cachedModels],
    },
    {
      key: "groupingThreshold",
      type: "number",
      label: "Grouping Threshold",
      defaultValue: 4,
      description:
        "Minimum number of changed files to trigger grouped commit mode",
      extensionLabel: "Committer",
      order: 1,
    },
    {
      key: "maxDiffLength",
      type: "number",
      label: "Max Diff Length (grouped)",
      defaultValue: MAX_DIFF_LENGTH,
      description: `Max diff bytes sent to LLM in grouped commit mode (default ${MAX_DIFF_LENGTH})`,
      extensionLabel: "Committer",
      order: 2,
    },
    {
      key: "maxDiffLengthSingle",
      type: "number",
      label: "Max Diff Length (single)",
      defaultValue: MAX_DIFF_LENGTH_SINGLE,
      description: `Max diff bytes sent to LLM in single commit mode (default ${MAX_DIFF_LENGTH_SINGLE})`,
      extensionLabel: "Committer",
      order: 3,
    },
    {
      key: "maxGroupingRetries",
      type: "number",
      label: "Max Grouping Retries",
      defaultValue: MAX_GROUPING_RETRIES,
      description: `Max retries for LLM grouping to cover all files (default ${MAX_GROUPING_RETRIES})`,
      extensionLabel: "Committer",
      order: 4,
    },
  ]);

  pi.on("session_start", (_event, ctx) => {
    const models = ctx.modelRegistry.getAvailable();
    cachedModels = models.map((m) => ({
      label: `${m.provider}/${m.id}`,
      value: `${m.provider}/${m.id}`,
    }));
  });

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
