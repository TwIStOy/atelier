import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ExtensionConfigSchema, isStaleCtxError, readConfig, registerConfigItems } from "@htwang-contrib/common";
import { repairAssistantMessageGrammarLeaks } from "./grammar-repair.ts";
import { normalizePhantomToolUse } from "./phantom-tool-use.ts";
import { STRATEGIES } from "./strategies/index.ts";
import { wrapRootStringAsObject } from "./strategies/shape-repair-rules.ts";
import { applyStrategies, CONFIG_ID, DEFAULT_CONFIG, type ToolCallFixerConfig } from "./strategy.ts";

const CONFIG_SCHEMA: ExtensionConfigSchema<ToolCallFixerConfig> = {
  defaults: { ...DEFAULT_CONFIG },
};

function loadConfig(): ToolCallFixerConfig {
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
    {
      key: "grammarRepairEnabled",
      type: "boolean",
      label: "Grammar Repair",
      value: () => loadConfig().grammarRepairEnabled,
      description:
        "Detect and repair leaked tool-call grammar (GLM arg_key/arg_value) emitted as assistant text. Off by default; in Recover mode this can turn assistant text into tool execution.",
      extensionLabel: "Tool Call Fixer",
      order: 20,
    },
    {
      key: "grammarRepairMode",
      type: "select",
      label: "Grammar Repair Mode",
      value: () => loadConfig().grammarRepairMode,
      options: [
        { label: "Recover", value: "recover" },
        { label: "Strip", value: "strip" },
      ],
      description:
        "Recover strips leaked markup and appends recovered tool calls; Strip removes markup only and never executes. Only used when Grammar Repair is enabled.",
      extensionLabel: "Tool Call Fixer",
      order: 30,
    },
    {
      key: "grammarRepairRequireKnownTool",
      type: "boolean",
      label: "Grammar Repair: Require Known Tool",
      value: () => loadConfig().grammarRepairRequireKnownTool,
      description: "Only recover tool calls whose name is in the active tool registry.",
      extensionLabel: "Tool Call Fixer",
      order: 40,
    },
  ]);
}

export default function (pi: ExtensionAPI) {
  registerConfig();

  pi.on("tool_call", async (event, ctx) => {
    const config = loadConfig();
    const notes: string[] = [];
    if (config.enabled && typeof event.input === "string") {
      const wrapped = wrapRootStringAsObject(event.input, event.toolName);
      if (wrapped) {
        (event as { input: unknown }).input = wrapped.value;
        notes.push(`root-wrap: ${wrapped.note}`);
      }
    }
    const input = event.input as Record<string, unknown>;
    const outcome = applyStrategies(event.toolName, input, config, STRATEGIES);
    notes.push(...outcome.notes);
    if (notes.length === 0) {
      return;
    }
    if (!config.notifyOnStrategy) {
      return;
    }
    try {
      ctx.ui.notify(`tool-call-fixer: adjusted ${event.toolName} (${notes.join("; ")})`, "info");
    } catch (err) {
      if (isStaleCtxError(err)) {
        return;
      }
      throw err;
    }
  });

  pi.on("message_end", async (event, ctx) => {
    const config = loadConfig();
    if (!config.enabled || event.message.role !== "assistant") {
      return;
    }
    let message = event.message;
    const notes: string[] = [];
    const phantom = normalizePhantomToolUse(message);
    if (phantom.changed) {
      message = phantom.message;
      notes.push("normalized phantom tool_use");
    }
    if (config.grammarRepairEnabled) {
      const repaired = repairAssistantMessageGrammarLeaks(
        message,
        {
          enabled: true,
          mode: config.grammarRepairMode,
          requireKnownTool: config.grammarRepairRequireKnownTool,
        },
        new Set(pi.getActiveTools()),
      );
      if (repaired.changed) {
        message = repaired.message;
        notes.push(`grammar repair: ${repaired.recoveredCalls.length} recovered, ${repaired.strippedRanges} stripped`);
      }
    }
    if (notes.length === 0) {
      return;
    }
    if (config.notifyOnStrategy) {
      try {
        ctx.ui.notify(`tool-call-fixer: ${notes.join("; ")}`, "info");
      } catch (err) {
        if (isStaleCtxError(err)) {
          return;
        }
        throw err;
      }
    }
    return { message };
  });
}
