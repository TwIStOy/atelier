import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ExtensionConfigSchema, isStaleCtxError, readConfig, registerConfigItems } from "@htwang-contrib/common";
import { STRATEGIES } from "./strategies/index.ts";
import { applyStrategies, CONFIG_ID, DEFAULT_CONFIG, type StrategyConfig } from "./strategy.ts";

const CONFIG_SCHEMA: ExtensionConfigSchema<StrategyConfig> = {
  defaults: { ...DEFAULT_CONFIG },
};

function loadConfig(): StrategyConfig {
  return readConfig(CONFIG_ID, CONFIG_SCHEMA);
}

function registerConfig(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "enabled",
      type: "boolean",
      label: "Enabled",
      value: () => loadConfig().enabled,
      description: "When on, registered strategies can adjust tool-call arguments before the tool executes.",
      extensionLabel: "Tool Call Fixer",
      order: 0,
    },
    {
      key: "notifyOnStrategy",
      type: "boolean",
      label: "Notify On Strategy",
      value: () => loadConfig().notifyOnStrategy,
      description: "Show a notification when a strategy adjusts a tool call.",
      extensionLabel: "Tool Call Fixer",
      order: 10,
    },
  ]);
}

export default function (pi: ExtensionAPI) {
  registerConfig();

  pi.on("tool_call", async (event, ctx) => {
    const config = loadConfig();
    const input = event.input as Record<string, unknown>;
    const outcome = applyStrategies(event.toolName, input, config, STRATEGIES);
    if (!outcome.applied) {
      return;
    }
    if (!config.notifyOnStrategy) {
      return;
    }
    try {
      ctx.ui.notify(`tool-call-fixer: adjusted ${event.toolName} (${outcome.notes.join("; ")})`, "info");
    } catch (err) {
      if (isStaleCtxError(err)) {
        return;
      }
      throw err;
    }
  });
}
