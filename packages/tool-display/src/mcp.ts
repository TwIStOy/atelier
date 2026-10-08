import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { snakeToCamelCase } from "./tool-call-display.ts";

export const MCP_STATUS_EVENT = "pi-mcp-adapter/status/v1";

const MCP_ADAPTER_PATH_MARKER = "pi-mcp-adapter";
const MCP_LABEL_PREFIX = "MCP";
const MCP_DISPLAY_PREFIX = "Mcp";

const mcpToolNames = new Set<string>();

// Built-in MCP tools are named `mcp__<server>__<tool>`; pi's own renderer resolver matches the
// same pattern, which also covers tools of resumed sessions whose server has not connected yet.
const BUILTIN_MCP_NAME = /^mcp__.+?__.+$/;

export function refreshMcpTools(pi: ExtensionAPI): void {
  mcpToolNames.clear();
  const getAllTools = (pi as Partial<ExtensionAPI>).getAllTools;
  if (typeof getAllTools !== "function") return;
  for (const tool of getAllTools.call(pi)) {
    if (tool.sourceInfo?.path?.includes(MCP_ADAPTER_PATH_MARKER)) {
      mcpToolNames.add(tool.name);
    }
  }
}

export function isMcpTool(toolName: string, label?: string): boolean {
  if (mcpToolNames.has(toolName)) return true;
  if (BUILTIN_MCP_NAME.test(toolName)) return true;
  return label === MCP_LABEL_PREFIX || label?.startsWith(`${MCP_LABEL_PREFIX}: `) === true;
}

export function clearMcpTools(): void {
  mcpToolNames.clear();
}

export function mcpDisplayName(toolName: string, label?: string): string {
  const suffix = label?.startsWith(`${MCP_LABEL_PREFIX}: `) ? label.slice(MCP_LABEL_PREFIX.length + 2).trim() : "";
  if (suffix) return `${MCP_DISPLAY_PREFIX}${snakeToCamelCase(suffix)}`;
  if (label === MCP_LABEL_PREFIX || toolName === "mcp") return MCP_DISPLAY_PREFIX;
  return snakeToCamelCase(toolName);
}
