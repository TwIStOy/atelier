import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { childSessionIndexPath, recordChildSessionFinished, recordChildSessionStarted } from "../src/session-links.ts";

describe("session-links", () => {
  const originalHome = process.env.HOME;
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "session-links-"));
    process.env.HOME = tmpHome;
  });
  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  function readRecords(parentId: string): Record<string, unknown>[] {
    const file = childSessionIndexPath(parentId);
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it("writes a running record on start and a done record on finish", () => {
    const parentId = "parent-123";
    recordChildSessionStarted(parentId, {
      parentSessionFile: "/tmp/parent.jsonl",
      childSessionFile: "/tmp/child.jsonl",
    });
    recordChildSessionFinished(parentId, {
      parentSessionFile: "/tmp/parent.jsonl",
      childSessionFile: "/tmp/child.jsonl",
      toolCalls: 2,
    });

    const lines = readRecords(parentId);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      parent_session_id: parentId,
      parent_session_file: "/tmp/parent.jsonl",
      sub_session_file: "/tmp/child.jsonl",
      status: "running",
    });
    expect(lines[0].started_at).toBeTruthy();
    expect(lines[1]).toMatchObject({
      parent_session_id: parentId,
      sub_session_file: "/tmp/child.jsonl",
      tool_calls: 2,
      status: "done",
    });
    expect(lines[1].ended_at).toBeTruthy();
  });

  it("records an error status when passed", () => {
    const parentId = "parent-err";
    recordChildSessionStarted(parentId, { parentSessionFile: "p", childSessionFile: "c" });
    recordChildSessionFinished(parentId, {
      parentSessionFile: "p",
      childSessionFile: "c",
      toolCalls: 0,
      status: "error",
    });
    const lines = readRecords(parentId);
    expect(lines[1]?.status).toBe("error");
  });
});
