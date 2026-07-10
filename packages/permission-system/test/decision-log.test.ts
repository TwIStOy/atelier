import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type DecisionRecord, FileDecisionLogger } from "../src/decision-log.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "perm-log-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function readLog(path = join(dir, "review.jsonl")): DecisionRecord[] {
  const raw = readFileSync(path, "utf-8");
  return raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as DecisionRecord);
}

describe("DecisionLogger", () => {
  it("appends one JSONL line per record", () => {
    const logger = new FileDecisionLogger({ path: join(dir, "review.jsonl"), enabled: true });
    logger.record({ tool: "bash", action: "execute", decision: "allow", trigger: "command:npm test" });
    logger.record({ tool: "read", action: "read", decision: "deny", trigger: "path:.env", reason: "denied" });

    const lines = readLog();
    expect(lines).toHaveLength(2);
    expect(lines[0]?.tool).toBe("bash");
    expect(lines[0]?.decision).toBe("allow");
    expect(lines[1]?.decision).toBe("deny");
  });

  it("includes an ISO timestamp on every record", () => {
    const logger = new FileDecisionLogger({ path: join(dir, "review.jsonl"), enabled: true });
    logger.record({ tool: "bash", action: "execute", decision: "allow", trigger: "none" });
    const [line] = readLog();
    expect(line?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("writes nothing when disabled", () => {
    const logger = new FileDecisionLogger({ path: join(dir, "review.jsonl"), enabled: false });
    logger.record({ tool: "bash", action: "execute", decision: "allow", trigger: "none" });
    expect(() => readFileSync(join(dir, "review.jsonl"), "utf-8")).toThrow();
  });

  it("never throws on IO failure (swallows the error)", () => {
    // Point at a path inside a file (not a directory) so the write fails.
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "x");
    const logger = new FileDecisionLogger({ path: join(blocker, "review.jsonl"), enabled: true });
    expect(() => logger.record({ tool: "bash", action: "execute", decision: "allow", trigger: "none" })).not.toThrow();
  });

  it("creates the logs directory if it does not exist", () => {
    const nested = join(dir, "nested", "deep", "review.jsonl");
    const logger = new FileDecisionLogger({ path: nested, enabled: true });
    logger.record({ tool: "bash", action: "execute", decision: "allow", trigger: "none" });
    expect(readLog(nested)).toHaveLength(1);
  });
});
