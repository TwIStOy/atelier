import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSubagentMessages, loadSubagentRuns } from "./index.ts";

function findSampleChildSession(): string | null {
  const dir = path.join(os.homedir(), ".agent", "subagents", "session");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(dir, f));
  return files[0] ?? null;
}

describe("subagents viewer-index", () => {
  it("loadSubagentMessages parses a real child session into messages", () => {
    const sample = findSampleChildSession();
    if (!sample) {
      console.warn("no sample child session; skipping");
      return;
    }
    const messages = loadSubagentMessages(sample);
    expect(messages.length).toBeGreaterThan(0);
    const roles = new Set(messages.map((m) => m.role));
    expect(roles.has("user")).toBe(true);
    expect(roles.has("assistant")).toBe(true);
  });

  it("loadSubagentMessages handles a missing file gracefully", () => {
    const messages = loadSubagentMessages("/nonexistent/path.jsonl");
    expect(messages).toEqual([]);
  });

  it("loadSubagentRuns returns runs for a known parent or empty for unknown", () => {
    const runsUnknown = loadSubagentRuns("definitely-not-a-real-parent-id");
    expect(runsUnknown).toEqual([]);

    const byParentDir = path.join(os.homedir(), ".agent", "subagents", "by-parent");
    if (!fs.existsSync(byParentDir)) {
      console.warn("no by-parent dir; skipping positive case");
      return;
    }
    const files = fs.readdirSync(byParentDir).filter((f) => f.endsWith(".jsonl"));
    if (files.length === 0) {
      console.warn("no by-parent index files; skipping positive case");
      return;
    }
    const parentSessionId = files[0]!.replace(/\.jsonl$/i, "");
    const runs = loadSubagentRuns(parentSessionId);
    expect(runs.length).toBeGreaterThan(0);
    const run = runs[0]!;
    expect(typeof run.id).toBe("string");
    expect(typeof run.subSessionFile).toBe("string");
    expect(fs.existsSync(run.subSessionFile)).toBe(true);
    expect(typeof run.toolCalls).toBe("number");
  });
});
