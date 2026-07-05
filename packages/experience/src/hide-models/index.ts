import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerConfigItems } from "@htwang-contrib/common";
import { handleHideModels } from "./command.ts";
import { CONFIG_ID, loadConfig } from "./config.ts";
import { buildHideRuleOptions, captureRegistry, installPatch, setSuppress } from "./model-patch.ts";

const EXTENSION_LABEL = "Experience";

function registerHideModelsConfig(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "enabled",
      type: "boolean",
      label: "Hide Models Enabled",
      value: () => loadConfig().enabled,
      description: "Master toggle for the model-hiding patch. When off, no models are filtered.",
      extensionLabel: EXTENSION_LABEL,
      order: 0,
    },
    {
      key: "hiddenRules",
      type: "multiselect",
      label: "Hidden Models / Providers",
      value: () => loadConfig().hiddenRules,
      options: () => buildHideRuleOptions(),
      description:
        "Providers/models hidden from the model picker. Select a provider to hide all of its models, or individual models. Takes effect immediately.",
      extensionLabel: EXTENSION_LABEL,
      order: 10,
    },
  ]);
}

export function registerHideModels(pi: ExtensionAPI): void {
  registerHideModelsConfig();
  installPatch();
  setSuppress(false);

  pi.on("session_start", (_event, ctx) => {
    captureRegistry(ctx.modelRegistry);
    setSuppress(false);
  });

  pi.registerCommand("hide-models", {
    description: "Hide providers/models from the model picker (add/remove/reset/status)",
    handler: handleHideModels,
  });
}
