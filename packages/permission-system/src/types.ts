export type PermissionState = "allow" | "ask" | "deny";

export type PermissionSource = "tool" | "bash" | "special" | "session" | "path";

export type PermissionOrigin = "builtin" | "global" | "project" | "agent";

export interface PermissionCheckResult {
  state: PermissionState;
  toolName: string;
  source: PermissionSource;
  origin?: PermissionOrigin;
  command?: string;
  matchedPattern?: string;
  commandContext?: BashCommandContext;
  reason?: string;
}

export type BashCommandContext = "command_substitution" | "process_substitution" | "subshell";

export interface BashCommand {
  readonly text: string;
  readonly context?: BashCommandContext;
  readonly opaque?: boolean;
}

export interface BashToolInput {
  command: string;
  timeout?: number;
}

export type PathRuleTokenMatcher = (token: string) => boolean;

export interface ScopedPermissionResolver {
  resolve(intent: unknown): PermissionCheckResult;
}

export interface FlatPermissionConfig {
  "*": PermissionState;
  [key: string]: unknown;
}
