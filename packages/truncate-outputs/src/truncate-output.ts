import * as nodeCrypto from "node:crypto";
import * as nodePath from "node:path";

export interface TruncateConfig {
  enabled: boolean;
  threshold: number;
  dir: string;
  toolDenylist: string[];
}

export const CONFIG_ID = "truncate-outputs";

export const DEFAULT_CONFIG: TruncateConfig = {
  enabled: true,
  threshold: 30_000,
  dir: "/tmp",
  toolDenylist: ["read", "bash"],
};

export interface ToolOutput {
  toolName: string;
  text: string;
}

export interface TruncationDecision {
  truncate: boolean;
  reason?: "disabled" | "denied" | "below-threshold";
}

export function shouldTruncate(toolName: string, byteLength: number, config: TruncateConfig): TruncationDecision {
  if (!config.enabled) {
    return { truncate: false, reason: "disabled" };
  }
  if (config.toolDenylist.includes(toolName)) {
    return { truncate: false, reason: "denied" };
  }
  if (byteLength <= config.threshold) {
    return { truncate: false, reason: "below-threshold" };
  }
  return { truncate: true };
}

export function buildTempFilePath(toolName: string, toolCallId: string, config: TruncateConfig): string {
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "tool";
  const id = toolCallId.replace(/[^a-zA-Z0-9_-]+/g, "").slice(0, 24) || nodeCrypto.randomBytes(6).toString("hex");
  return nodePath.join(config.dir, `pi-${safeTool}-${id}.txt`);
}

export function buildReplacementMessage(
  output: ToolOutput,
  byteLength: number,
  lineCount: number,
  savedPath: string,
  config: TruncateConfig,
): string {
  const threshold = config.threshold;
  return [
    `Tool "${output.toolName}" produced ${byteLength.toLocaleString("en-US")} bytes (${lineCount.toLocaleString("en-US")} lines) of output, exceeding the ${threshold.toLocaleString("en-US")}-byte limit.`,
    "",
    `The full output has been saved to: ${savedPath}`,
    "",
    "To inspect it without flooding the context window:",
    `- Use the ranged read tool: read "${savedPath}" with a small limit and/or an offset, paging through as needed.`,
    `- Use \`rg "<pattern>" "${savedPath}"\` to search the saved output for what you need.`,
    "Prefer targeted reads over loading the whole file.",
  ].join("\n");
}

export function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      count++;
    }
  }
  if (text.charCodeAt(text.length - 1) !== 10) {
    count++;
  }
  return count;
}
