import { existsSync, readFileSync } from "node:fs";
import type { ZodError } from "zod";
import { getGlobalConfigPath, getProjectConfigPath } from "./config-paths.ts";
import type { PermissionState } from "./config-schema.ts";
import { type FlatPermissionConfig, type UnifiedPermissionConfig, unifiedConfigSchema } from "./config-schema.ts";

export type { UnifiedPermissionConfig };

export interface UnifiedConfigLoadResult {
  config: UnifiedPermissionConfig;
  issues: string[];
}

// ── JSONC parsing ─────────────────────────────────────────────────────────

/**
 * Strip `//` line comments and `/* … *​/` block comments from a JSONC string,
 * honoring string literals so a `//` or `/*` inside a string is not treated
 * as a comment. Returns valid JSON ready for `JSON.parse`.
 */
export function stripJsonComments(input: string): string {
  let output = "";
  let i = 0;
  while (i < input.length) {
    const char = input[i];
    const next = input[i + 1] ?? "";

    if (char === "/" && next === "/") {
      const newlineIndex = input.indexOf("\n", i);
      output += "\n";
      i = newlineIndex === -1 ? input.length : newlineIndex + 1;
      continue;
    }
    if (char === "/" && next === "*") {
      const closeIndex = input.indexOf("*/", i + 2);
      i = closeIndex === -1 ? input.length : closeIndex + 2;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      output += quote;
      i++;
      let escaping = false;
      while (i < input.length) {
        const c = input[i]!;
        output += c;
        i++;
        if (escaping) {
          escaping = false;
          continue;
        }
        if (c === "\\") {
          escaping = true;
          continue;
        }
        if (c === quote) break;
      }
      continue;
    }

    output += char;
    i++;
  }
  return output;
}

// ── Validation ────────────────────────────────────────────────────────────

export function validateUnifiedConfig(parsed: unknown): UnifiedConfigLoadResult {
  const result = unifiedConfigSchema.safeParse(parsed);
  if (result.success) return { config: result.data, issues: [] };
  return { config: {}, issues: formatConfigIssues(result.error) };
}

function formatConfigIssues(error: ZodError): string[] {
  const messages: string[] = [];
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) messages.push(`Unrecognized config key '${key}'.`);
      continue;
    }
    const location = issue.path.length > 0 ? issue.path.map(String).join(".") : "(root)";
    messages.push(`Invalid config value at '${location}': ${issue.message}`);
  }
  return messages;
}

// ── Merge ─────────────────────────────────────────────────────────────────

/**
 * Deep-merge two permission maps: for each surface, override's value replaces
 * base's when it is a string; when both are objects, merge pattern→action
 * (override-wins per pattern). This preserves the user's "broad first,
 * specific after" ordering within a surface.
 */
export function mergeFlatPermissions(base: FlatPermissionConfig, override: FlatPermissionConfig): FlatPermissionConfig {
  const merged: FlatPermissionConfig = { ...base };
  for (const [surface, overrideValue] of Object.entries(override)) {
    const baseValue = merged[surface];
    if (
      typeof baseValue === "object" &&
      baseValue !== null &&
      typeof overrideValue === "object" &&
      overrideValue !== null
    ) {
      merged[surface] = { ...baseValue, ...overrideValue };
    } else {
      merged[surface] = overrideValue;
    }
  }
  return merged;
}

/** Merge two unified configs (override wins; permission map deep-merged). */
export function mergeUnifiedConfigs(
  base: UnifiedPermissionConfig,
  override: UnifiedPermissionConfig,
): UnifiedPermissionConfig {
  const merged: UnifiedPermissionConfig = {};
  const basePerm = base.permission;
  const overridePerm = override.permission;
  if (basePerm && overridePerm) {
    merged.permission = mergeFlatPermissions(basePerm, overridePerm);
  } else if (overridePerm) {
    merged.permission = overridePerm;
  } else if (basePerm) {
    merged.permission = basePerm;
  }
  return merged;
}

// ── Defaults ──────────────────────────────────────────────────────────────

/**
 * The dev-friendly default policy baked in when no config is present
 * (RESEARCH.md §10 D2): reads allowed, writes/executes ask, sensitive paths
 * (.env, ~/.ssh) denied everywhere via the cross-cutting `path` surface.
 */
export const DEFAULT_PERMISSION_CONFIG: FlatPermissionConfig = {
  "*": "ask",
  read: "allow",
  write: "ask",
  edit: "ask",
  bash: "ask",
  path: {
    "*": "allow",
    "*.env": "deny",
    "*.env.*": "deny",
    "~/.ssh/*": "deny",
  },
  external_directory: { "*": "ask" },
};

export function applyDefaults(config: UnifiedPermissionConfig): FlatPermissionConfig {
  return mergeFlatPermissions(DEFAULT_PERMISSION_CONFIG, config.permission ?? {});
}

// ── Permissive-bash fallback warning ──────────────────────────────────────

/**
 * Detect the footgun where a permissive top-level `*: allow` leaves bash
 * ungated. Returns a warning string when `permission["*"] === "allow"` and the
 * `bash` surface neither is a bare string nor has an explicit `*` key.
 */
export function detectPermissiveBashFallback(permission: FlatPermissionConfig | undefined): string | undefined {
  if (permission?.["*"] !== "allow") return undefined;

  const surfaces: Partial<FlatPermissionConfig> = permission;
  const bash = surfaces.bash;
  if (typeof bash === "string") return undefined;
  if (bash && typeof bash === "object" && Object.hasOwn(bash, "*")) return undefined;

  return (
    "Permission config sets a permissive top-level '*': 'allow' with no 'bash' '*' policy, " +
    "so bash commands silently inherit 'allow'. Set an explicit 'bash' policy " +
    '(e.g. "bash": { "*": "ask" }) to gate bash commands.'
  );
}

// ── Top-level load ────────────────────────────────────────────────────────

export interface MergedConfigResult {
  global: UnifiedPermissionConfig;
  project: UnifiedPermissionConfig;
  merged: UnifiedPermissionConfig;
  /** Final permission map with defaults applied. */
  permission: FlatPermissionConfig;
  issues: string[];
}

/**
 * Load global + project configs, deep-merge them (project overrides global),
 * apply the dev-friendly defaults, and collect validation/warning issues.
 *
 * Global lives at `getAgentDir()/extensions/permission-system/config.json`
 * (resolved by the caller via pi's `getAgentDir()`); project lives at
 * `<cwd>/.pi/extensions/permission-system/config.json`.
 */
export function loadAndMergeConfigs(agentDir: string, cwd: string): MergedConfigResult {
  const issues: string[] = [];

  const globalResult = loadUnifiedConfig(getGlobalConfigPath(agentDir));
  issues.push(...globalResult.issues);
  const globalConfig = globalResult.config;

  const projectResult = loadUnifiedConfig(getProjectConfigPath(cwd));
  issues.push(...projectResult.issues);
  const projectConfig = projectResult.config;

  const merged = mergeUnifiedConfigs(globalConfig, projectConfig);

  const bashFallbackIssue = detectPermissiveBashFallback(merged.permission);
  if (bashFallbackIssue) issues.push(bashFallbackIssue);

  return {
    global: globalConfig,
    project: projectConfig,
    merged,
    permission: applyDefaults(merged),
    issues,
  };
}

/** Load + validate one JSONC config file (empty result if absent). */
export function loadUnifiedConfig(path: string): UnifiedConfigLoadResult {
  if (!existsSync(path)) return { config: {}, issues: [] };
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(stripJsonComments(raw)) as unknown;
    return validateUnifiedConfig(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { config: {}, issues: [`Failed to read config at '${path}': ${message}`] };
  }
}

// Re-export the state type for callers that build configs programmatically.
export type { PermissionState };
