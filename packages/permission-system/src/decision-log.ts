import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * The final disposition of a tool call, as recorded for audit. Distinguishes
 * the path the decision took so a review can tell "allowed by rule" from
 * "allowed because the user said yes".
 *
 * - `allow`               — a gate returned allow (no prompt).
 * - `ask-allowed`         — the user picked Allow once / Allow always (session).
 * - `ask-denied`          — the user picked Deny.
 * - `ask-headless-denied` — ask in headless mode → fail-closed deny.
 * - `deny`                — a gate returned deny (rule-based block).
 */
export type DecisionOutcome = "allow" | "ask-allowed" | "ask-denied" | "ask-headless-denied" | "deny";

/** One JSONL record in the review log. */
export interface DecisionRecord {
  timestamp: string;
  tool: string;
  action: string;
  decision: DecisionOutcome;
  /** The approval key / trigger description (e.g. `command:npm test`, `path:.env`). */
  trigger: string;
  reason?: string;
}

export interface DecisionLoggerOptions {
  /** Absolute path to the JSONL file. */
  path: string;
  /** When false, record() is a no-op. */
  enabled: boolean;
}

/** Append-only JSONL audit log of every permission decision. Writes one
 * `{ ...DecisionRecord }` object per line to the configured path. All IO
 * failures are swallowed — diagnostics must never break an agent turn. */
export interface DecisionLogger {
  record(entry: Omit<DecisionRecord, "timestamp">): void;
}

export class FileDecisionLogger implements DecisionLogger {
  constructor(private readonly options: DecisionLoggerOptions) {}

  record(entry: Omit<DecisionRecord, "timestamp">): void {
    if (!this.options.enabled) return;
    const line = JSON.stringify({ timestamp: new Date().toISOString(), ...entry });
    try {
      mkdirSync(dirname(this.options.path), { recursive: true });
      appendFileSync(this.options.path, `${line}\n`, "utf8");
    } catch {
      // Diagnostics must never break the agent turn.
    }
  }
}
