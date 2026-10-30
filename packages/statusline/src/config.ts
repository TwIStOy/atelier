import type { ExtensionConfigSchema } from "@htwang-contrib/common";
import { readConfig, registerConfigItems } from "@htwang-contrib/common";

export interface StatuslineConfig {
  showGitBranch: boolean;
  /** Master switch for the post-run telemetry notification (TPS/TTFT/stalls). */
  telemetry: boolean;
  /** Render extension statuses set via ctx.ui.setStatus() in the footer. */
  showExtensionStatus: boolean;
}

const CONFIG_NAME = "statusline";

const CONFIG_SCHEMA: ExtensionConfigSchema<StatuslineConfig> = {
  defaults: {
    showGitBranch: true,
    telemetry: true,
    showExtensionStatus: true,
  },
};

export function loadConfig(): StatuslineConfig {
  return readConfig(CONFIG_NAME, CONFIG_SCHEMA);
}

export function registerStatuslineConfigItems(): void {
  registerConfigItems(CONFIG_NAME, [
    {
      key: "showGitBranch",
      type: "boolean",
      label: "Show Git Branch",
      value: () => loadConfig().showGitBranch,
      description:
        "Show the git branch and dirty marker in the footer. Turn off in large repos where git status is slow.",
      extensionLabel: "Statusline",
      order: 0,
    },
    {
      key: "telemetry",
      type: "boolean",
      label: "Turn Telemetry",
      value: () => loadConfig().telemetry,
      description: "Show a one-line notification (TPS, TTFT, stalls, tokens, cost) after each agent run settles.",
      extensionLabel: "Statusline",
      order: 1,
    },
    {
      key: "showExtensionStatus",
      type: "boolean",
      label: "Show Extension Statuses",
      value: () => loadConfig().showExtensionStatus,
      description:
        "Render values set by extensions via ctx.ui.setStatus() (e.g. agents-mirror injection count) in the footer.",
      extensionLabel: "Statusline",
      order: 2,
    },
  ]);
}
