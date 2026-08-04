import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  callsMatch,
  listRunRecords,
  loadRunRecord,
  pruneRunRecords,
  resumeCheckpoint,
  type WorkflowRunRecord,
  writeRunRecord,
} from "../src/run-store.ts";

function record(id: string, over: Partial<WorkflowRunRecord> = {}): WorkflowRunRecord {
  return {
    id,
    name: "test",
    script: "export const meta = { name: 't', description: 'd' };",
    status: "done",
    startedAt: 1,
    agents: [],
    ...over,
  };
}

describe("run-store", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-runs-"));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("writes and loads a run record", () => {
    writeRunRecord(record("abc", { args: { x: 1 } }), home);
    const loaded = loadRunRecord("abc", home);
    expect(loaded?.id).toBe("abc");
    expect(loaded?.args).toEqual({ x: 1 });
  });

  it("returns undefined for missing or malformed records", () => {
    expect(loadRunRecord("nope", home)).toBeUndefined();
    const dir = path.join(home, ".agent", "workflow", "runs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "bad.json"), "{broken");
    expect(loadRunRecord("bad", home)).toBeUndefined();
  });

  it("lists newest first and prunes beyond the keep limit", () => {
    for (let i = 1; i <= 5; i++) {
      writeRunRecord(record(`r${i}`, { startedAt: i }), home);
    }
    const listed = listRunRecords(3, home);
    expect(listed.map((r) => r.id)).toEqual(["r5", "r4", "r3"]);
    pruneRunRecords(2, home);
    expect(listRunRecords(10, home).map((r) => r.id)).toEqual(["r5", "r4"]);
  });
});

describe("resumeCheckpoint", () => {
  it("returns the first seq without an ok record", () => {
    const agents = [
      { seq: 1, call: { label: "a", task: "t" }, ok: true, endedAt: 1 },
      { seq: 2, call: { label: "b", task: "t" }, ok: false, endedAt: 2 },
      { seq: 3, call: { label: "c", task: "t" }, ok: true, endedAt: 3 },
    ];
    expect(resumeCheckpoint(agents)).toBe(2);
  });

  it("returns past the end when all agents succeeded", () => {
    const agents = [
      { seq: 1, call: { label: "a", task: "t" }, ok: true, endedAt: 1 },
      { seq: 2, call: { label: "b", task: "t" }, ok: true, endedAt: 2 },
    ];
    expect(resumeCheckpoint(agents)).toBe(3);
  });

  it("returns 1 for an empty history", () => {
    expect(resumeCheckpoint([])).toBe(1);
  });
});

describe("callsMatch", () => {
  it("compares call objects structurally", () => {
    expect(callsMatch({ label: "a", task: "t" }, { label: "a", task: "t" })).toBe(true);
    expect(callsMatch({ label: "a", task: "t" }, { label: "a", task: "x" })).toBe(false);
  });
});
