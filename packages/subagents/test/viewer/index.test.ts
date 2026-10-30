import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { recordChildSessionStarted } from "@htwang-contrib/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSubagentMessages, loadSubagentRuns } from "../../src/viewer/index.ts";
import { writeChildSession } from "./fixtures.ts";

const originalHome = process.env.HOME;
let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "subagents-viewer-"));
  process.env.HOME = tmpHome;
});
afterEach(() => {
  process.env.HOME = originalHome;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("subagents viewer-index", () => {
  it("loadSubagentMessages parses a child session into messages", () => {
    const childFile = writeChildSession(path.join(tmpHome, "sessions"));
    const messages = loadSubagentMessages(childFile);
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
    expect(loadSubagentRuns("definitely-not-a-real-parent-id")).toEqual([]);

    const childFile = writeChildSession(path.join(tmpHome, "sessions"));
    const parentSessionId = "parent-with-runs";
    recordChildSessionStarted(parentSessionId, { parentSessionFile: "", childSessionFile: childFile });

    const runs = loadSubagentRuns(parentSessionId);
    expect(runs.length).toBeGreaterThan(0);
    const run = runs[0]!;
    expect(typeof run.id).toBe("string");
    expect(typeof run.subSessionFile).toBe("string");
    expect(fs.existsSync(run.subSessionFile)).toBe(true);
    expect(typeof run.toolCalls).toBe("number");
  });
});
