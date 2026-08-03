import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import { childSessionIndexPath, recordChildSessionFinished, recordChildSessionStarted } from "@htwang-contrib/common";
import { describe, expect, it } from "vitest";
import { loadSubagentRuns, refreshRunRunning } from "../../src/viewer/index.ts";

initTheme(undefined, false);

function makeHeader(id: string): string {
  return JSON.stringify({
    type: "session",
    version: 3,
    id,
    timestamp: new Date().toISOString(),
    cwd: os.homedir(),
    parentSession: "test-parent",
  });
}

function userEntry(parentId: string, text: string): string {
  return JSON.stringify({
    type: "message",
    id: crypto.randomBytes(4).toString("hex"),
    parentId,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

function assistantEntry(parentId: string, text: string): string {
  return JSON.stringify({
    type: "message",
    id: crypto.randomBytes(4).toString("hex"),
    parentId,
    timestamp: new Date().toISOString(),
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

describe("subagents live index (running state)", () => {
  it("recordSubagentStarted makes loadSubagentRuns see a running entry before done", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sub-live-"));
    const subFile = path.join(tmp, "child.jsonl");
    fs.writeFileSync(subFile, "");
    const sessionId = `test-parent-live-${crypto.randomBytes(4).toString("hex")}`;

    // hijack the index path by writing directly via the exported helpers
    // (they target ~/.agent/subagents/by-parent/<id>.jsonl)
    recordChildSessionStarted(sessionId, {
      parentSessionFile: "",
      childSessionFile: subFile,
    });

    // child file has no messages yet -> run filtered out (messages.length === 0)
    let runs = loadSubagentRuns(sessionId);
    expect(runs.length).toBe(0);

    // append a user message -> now the run appears as running
    fs.appendFileSync(subFile, `${makeHeader("h1")}\n`);
    fs.appendFileSync(subFile, `${userEntry("h1", "hello")}\n`);
    runs = loadSubagentRuns(sessionId);
    expect(runs.length).toBe(1);
    expect(runs[0]!.running).toBe(true);
    expect(refreshRunRunning(sessionId, subFile).running).toBe(true);

    // append an assistant message (still running)
    fs.appendFileSync(subFile, `${assistantEntry("h1", "world")}\n`);
    runs = loadSubagentRuns(sessionId);
    expect(runs[0]!.running).toBe(true);

    // finalize: done record supersedes running
    recordChildSessionFinished(sessionId, {
      parentSessionFile: "",
      childSessionFile: subFile,
      toolCalls: 2,
    });
    runs = loadSubagentRuns(sessionId);
    expect(runs[0]!.running).toBe(false);
    expect(runs[0]!.toolCalls).toBe(2);
    expect(refreshRunRunning(sessionId, subFile).running).toBe(false);

    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(childSessionIndexPath(sessionId), { force: true });
  });
});
