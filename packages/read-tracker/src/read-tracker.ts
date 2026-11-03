import * as fs from "node:fs";

export interface ReadEntry {
  /** Wall-clock time (ms since epoch) when the read tool fired. */
  readAt: number;
  /** File mtime (ms since epoch) captured immediately after the read. */
  modifiedAt: number;
  /** File size (bytes) captured immediately after the read. */
  size: number;
}

export interface BlockReason {
  block: true;
  reason: string;
}

export type CheckResult = BlockReason | null;

const NEW_FILE = "new file";
const UNREAD = "unread";
const STALE = "stale";
const OK = "ok";

export type CheckOutcome = "new file" | "unread" | "stale" | "ok";

function checkOutcomeToReason(outcome: CheckOutcome): string {
  switch (outcome) {
    case UNREAD:
      return "Read the file before editing it. (run /read-tracker to see tracked files)";
    case STALE:
      return "File has been modified since you read it. Re-read before editing.";
    default:
      return "";
  }
}

export class ReadTracker {
  private readonly log = new Map<string, ReadEntry>();

  record(rawPath: string): void {
    let canonical: string;
    let stat: fs.Stats;
    try {
      canonical = fs.realpathSync(rawPath);
      stat = fs.statSync(canonical);
    } catch {
      return;
    }
    this.log.set(canonical, {
      readAt: Date.now(),
      modifiedAt: stat.mtimeMs,
      size: stat.size,
    });
  }

  check(rawPath: string): CheckResult {
    return this.checkVerbose(rawPath).blockReason;
  }

  checkVerbose(rawPath: string): {
    outcome: CheckOutcome;
    reason: string;
    blockReason: CheckResult;
  } {
    let canonical: string;
    try {
      canonical = fs.realpathSync(rawPath);
    } catch {
      return {
        outcome: NEW_FILE,
        reason: "",
        blockReason: null,
      };
    }
    const entry = this.log.get(canonical);
    if (!entry) {
      const reason = checkOutcomeToReason(UNREAD);
      return { outcome: UNREAD, reason, blockReason: { block: true, reason } };
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(canonical);
    } catch {
      return { outcome: OK, reason: "", blockReason: null };
    }
    if (stat.mtimeMs !== entry.modifiedAt || stat.size !== entry.size) {
      const reason = checkOutcomeToReason(STALE);
      return { outcome: STALE, reason, blockReason: { block: true, reason } };
    }
    return { outcome: OK, reason: "", blockReason: null };
  }

  refresh(rawPath: string): void {
    this.record(rawPath);
  }

  clear(): void {
    this.log.clear();
  }

  paths(): readonly string[] {
    return Array.from(this.log.keys());
  }

  entries(): ReadonlyArray<readonly [string, ReadEntry]> {
    return Array.from(this.log.entries());
  }
}
