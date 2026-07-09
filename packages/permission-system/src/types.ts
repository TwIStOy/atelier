import type { AccessPath } from "./access-intent/access-path.ts";

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
  resolve(intent: AccessIntent): PermissionCheckResult;
}

// ── Tool-call gate context ────────────────────────────────────────────────

export interface ToolCallContext {
  toolName: string;
  agentName: string | null;
  input: unknown;
  cwd: string;
}

// ── Gate result (v1: the decision a gate produces) ────────────────────────
// null = the gate does not apply (e.g. not bash, no path, no external dir).
// A non-null result carries the resolved state, the action category, and a
// trigger describing what path/command fired it — enough for a future
// session-approval / config-allow layer to match on without re-deriving it.
// Prompt copy, audit-log records, and decision events are still NOT here;
// those are Step 5/6 concerns.

/** The category of operation a tool call performs. Extensible. */
export type ToolAction = "read" | "write" | "execute" | "delete";

/**
 * What triggered a gate. A discriminated union so a session-allow layer can
 * dispatch on `kind` and match the right shape (path aliases vs command
 * prefix) without inspecting loose optional fields.
 *
 * - `path`    — a filesystem path fired the gate (path/external-directory
 *   gates, for tools and for bash path tokens). `path` carries the lexical
 *   ∪ canonical aliases for matching; `display` is the raw token for prompts.
 * - `command` — a bash command fired the gate. `command` is the full string;
 *   `prefix` is the human-meaningful subcommand (via bash-arity) a session
 *   approval would remember.
 * - `none`    — a tool-level gate with no specific path/command (e.g. a tool
 *   gated purely by name).
 */
export type GateTrigger =
  | { kind: "path"; path: AccessPath; display: string }
  | { kind: "command"; command: string; prefix?: string }
  | { kind: "none" };

export interface GateResult {
  state: PermissionState;
  /** Operation category, derived from the tool + gate. */
  action: ToolAction;
  /** What fired the gate; session/config allow layers match against this. */
  trigger: GateTrigger;
  /** Human-readable reason, populated mainly for deny. */
  reason?: string;
}

// ── Access intent (what a gate asks the resolver to check) ────────────────
// A discriminated union so a gate emits either a plain tool intent or an
// access-path intent (lexical ∪ canonical aliases, #418). The resolver unwraps
// `access-path` via `AccessPath.matchValues()` before matching string rules.

export type AccessIntent =
  | {
      kind: "tool";
      surface: string;
      input: unknown;
      agentName?: string;
    }
  | {
      kind: "access-path";
      surface: string;
      path: AccessPath;
      agentName?: string;
    };

export interface FlatPermissionConfig {
  "*": PermissionState;
  [key: string]: unknown;
}
