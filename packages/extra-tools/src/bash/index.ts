import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createBashToolDefinition } from "@earendil-works/pi-coding-agent";
import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common";
import { Type } from "typebox";

const CONFIG_ID = "extra-tools";

interface ExtraToolsConfig {
  extendedBash: boolean;
}

const CONFIG_SCHEMA: ExtensionConfigSchema<ExtraToolsConfig> = {
  defaults: {
    extendedBash: true,
  },
};

export function loadExtendedBash(): boolean {
  return readConfig(CONFIG_ID, CONFIG_SCHEMA).extendedBash;
}

const bashParams = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
  description: Type.String({
    description: "Brief human-readable summary of what this command does, shown in the session UI",
  }),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
});

export function registerBashTool(pi: ExtensionAPI) {
  registerConfigItems(CONFIG_ID, [
    {
      key: "extendedBash",
      type: "boolean",
      label: "Extended Bash",
      value: () => loadExtendedBash(),
      description:
        "Replace the built-in bash tool with an extended schema that requires a description of each command (shown in the tool call header). Takes effect after /reload.",
      extensionLabel: "Extra Tools",
      order: 0,
    },
  ]);

  if (!loadExtendedBash()) return;

  const inner = createBashToolDefinition(process.cwd());
  pi.registerTool({
    name: inner.name,
    label: inner.label,
    description: `${inner.description} Always set the \`description\` parameter to a brief summary of what the command does; it is rendered as the tool call header.`,
    promptSnippet: inner.promptSnippet,
    promptGuidelines: inner.promptGuidelines ? [...inner.promptGuidelines] : undefined,
    constrainedSampling: inner.constrainedSampling,
    parameters: bashParams,
    execute: (toolCallId, params, signal, onUpdate, ctx) =>
      inner.execute(toolCallId, { command: params.command, timeout: params.timeout }, signal, onUpdate, ctx),
    renderCall: inner.renderCall,
    renderResult: inner.renderResult,
  });
}
