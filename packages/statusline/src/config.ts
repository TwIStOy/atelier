import type { ExtensionConfigSchema } from "@htwang-contrib/common";
import { readConfig, registerConfigItems } from "@htwang-contrib/common";

export interface StatuslineConfig {
  showGitBranch: boolean;
}

const CONFIG_NAME = "statusline";

const CONFIG_SCHEMA: ExtensionConfigSchema<StatuslineConfig> = {
  defaults: {
    showGitBranch: true,
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
  ]);
}
