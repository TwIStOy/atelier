import type { GateTrigger } from "./types.ts";

/**
 * Derive the stable key a session approval is remembered under, from the gate
 * trigger that fired. Two calls producing the same key are treated as "the
 * same approval" so a user only confirms once per session.
 *
 * - `command` → `command:<prefix>` (or the full command when no prefix), so a
 *   confirmation on `npm test` covers `npm test --verbose` later but not
 *   `npm install`. The prefix is the bash-arity subcommand (e.g. `git push`).
 * - `path`    → `path:<display>` (the raw token/path the user saw).
 * - `none`    → `tool:<toolName>` (a whole tool confirmed by name).
 */
export function approvalKeyFromTrigger(trigger: GateTrigger): string {
  switch (trigger.kind) {
    case "command":
      return `command:${trigger.prefix ?? trigger.command}`;
    case "path":
      return `path:${trigger.display}`;
    case "none":
      return `tool:${trigger.toolName}`;
  }
}

/**
 * Per-session store of approvals the user chose to remember. Lives only for
 * the current pi session (cleared on session_start); never persisted to disk.
 */
export class SessionApprovalStore {
  private readonly approvals = new Set<string>();

  has(key: string): boolean {
    return this.approvals.has(key);
  }

  remember(key: string): void {
    this.approvals.add(key);
  }

  clear(): void {
    this.approvals.clear();
  }

  get size(): number {
    return this.approvals.size;
  }
}
