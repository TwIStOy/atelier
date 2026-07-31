import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import type { TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type ExtensionConfigSchema,
  isExtensionDisabled,
  isStaleCtxError,
  readConfig,
  registerConfigItems,
} from "@htwang-contrib/common";
import {
  buildReplacementMessage,
  buildTempFilePath,
  CONFIG_ID,
  countLines,
  DEFAULT_CONFIG,
  shouldTruncate,
  type TruncateConfig,
} from "./truncate-output.ts";

const COMMON_DENYLISTED_TOOLS = [
  { label: "read", value: "read" },
  { label: "bash", value: "bash" },
  { label: "grep", value: "grep" },
  { label: "glob", value: "glob" },
  { label: "edit", value: "edit" },
  { label: "write", value: "write" },
  { label: "subagents", value: "subagents" },
];

const CONFIG_SCHEMA: ExtensionConfigSchema<TruncateConfig> = {
  defaults: { ...DEFAULT_CONFIG },
};

function loadConfig(): TruncateConfig {
  return readConfig(CONFIG_ID, CONFIG_SCHEMA);
}

function registerConfig(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "enabled",
      type: "boolean",
      label: "Enabled",
      value: () => loadConfig().enabled,
      description: "When on, tool outputs larger than the threshold are saved to a file and replaced with a pointer.",
      extensionLabel: "Truncate Outputs",
      order: 0,
    },
    {
      key: "threshold",
      type: "number",
      label: "Threshold (bytes)",
      value: () => loadConfig().threshold,
      min: 1024,
      max: 1_000_000,
      description: "Tool outputs at or below this many bytes are left untouched; larger ones are offloaded to a file.",
      extensionLabel: "Truncate Outputs",
      order: 10,
    },
    {
      key: "dir",
      type: "string",
      label: "Output Directory",
      value: () => loadConfig().dir,
      description: "Directory where large tool outputs are written. Defaults to /tmp.",
      extensionLabel: "Truncate Outputs",
      order: 20,
    },
    {
      key: "toolDenylist",
      type: "multiselect",
      label: "Skipped Tools",
      value: () => loadConfig().toolDenylist,
      options: COMMON_DENYLISTED_TOOLS,
      description: "Tools whose output is never offloaded (e.g. read and bash already self-truncate).",
      extensionLabel: "Truncate Outputs",
      order: 30,
    },
  ]);
}

function writeOutputFile(targetPath: string, text: string): void {
  nodeFs.mkdirSync(nodePath.dirname(targetPath), { recursive: true });
  const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  nodeFs.writeFileSync(tmp, text, "utf8");
  nodeFs.renameSync(tmp, targetPath);
}

export default function (pi: ExtensionAPI) {
  if (isExtensionDisabled("truncate-outputs")) return;
  registerConfig();

  pi.on("tool_result", async (event, ctx) => {
    const config = loadConfig();
    const textParts = event.content.filter(
      (part): part is TextContent => part.type === "text" && typeof part.text === "string",
    );
    const text = textParts.map((part) => part.text).join("\n");
    const decision = shouldTruncate(event.toolName, Buffer.byteLength(text, "utf8"), config);
    if (!decision.truncate) {
      return;
    }

    const savedPath = buildTempFilePath(event.toolName, event.toolCallId, config);
    try {
      writeOutputFile(savedPath, text);
    } catch (err) {
      if (isStaleCtxError(err)) {
        return;
      }
      try {
        ctx.ui.notify(`truncate-outputs: failed to offload ${event.toolName} output: ${String(err)}`, "warning");
      } catch {
        // ctx may be stale during shutdown; nothing to do.
      }
      return;
    }

    const message = buildReplacementMessage(
      { toolName: event.toolName, text },
      Buffer.byteLength(text, "utf8"),
      countLines(text),
      savedPath,
      config,
    );

    return {
      content: [{ type: "text", text: message } satisfies TextContent],
    };
  });
}
