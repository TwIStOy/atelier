import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common";

export const CONFIG_ID = "tool-timeout";

export interface ExemptRule {
  tool: string;
  pattern: string;
}

export interface ToolTimeoutConfig {
  maxTimeoutSeconds: number;
  exemptRules: ExemptRule[];
}

export const DEFAULT_CONFIG: ToolTimeoutConfig = {
  maxTimeoutSeconds: 3600,
  exemptRules: [],
};

const CONFIG_SCHEMA: ExtensionConfigSchema<ToolTimeoutConfig> = {
  defaults: { ...DEFAULT_CONFIG, exemptRules: [] },
};

function normalizeMaxTimeoutSeconds(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_CONFIG.maxTimeoutSeconds;
  return Math.max(0, Math.floor(value));
}

export function normalizeExemptRules(value: unknown): ExemptRule[] {
  if (!Array.isArray(value)) return [];
  const rules: ExemptRule[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const tool = typeof entry.tool === "string" ? entry.tool.trim() : "";
    const pattern = typeof entry.pattern === "string" ? entry.pattern.trim() : "";
    if (tool.length === 0 || pattern.length === 0) continue;
    rules.push({ tool, pattern });
  }
  return rules;
}

export function matchesExemptRule(rules: ExemptRule[], toolName: string, input: Record<string, unknown>): boolean {
  return rules.some(
    (rule) =>
      rule.tool === toolName &&
      Object.values(input).some((value) => typeof value === "string" && value.includes(rule.pattern)),
  );
}

export function loadConfig(): ToolTimeoutConfig {
  const config = readConfig(CONFIG_ID, CONFIG_SCHEMA);
  return {
    maxTimeoutSeconds: normalizeMaxTimeoutSeconds(config.maxTimeoutSeconds),
    exemptRules: normalizeExemptRules(config.exemptRules),
  };
}

export function resolveBashTimeoutSeconds(requested: unknown, maxSeconds: number): number {
  if (typeof requested === "number" && Number.isFinite(requested) && requested > 0) {
    return Math.min(requested, maxSeconds);
  }
  return maxSeconds;
}

export function registerConfig(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "maxTimeoutSeconds",
      type: "number",
      label: "Max Timeout (seconds)",
      value: () => loadConfig().maxTimeoutSeconds,
      min: 0,
      max: 86400,
      description:
        "Wall-clock cap for every bash tool call. Calls without a timeout get this value; calls requesting a longer timeout are clamped to it. 0 disables the cap (pi's stock behavior: no default timeout). Per-call no-timeout exemptions are configured via the exemptRules array in extensions.json.",
      extensionLabel: "Tool Timeout",
      order: 0,
    },
  ]);
}
