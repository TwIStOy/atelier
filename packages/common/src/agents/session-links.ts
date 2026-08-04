import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function indexDir(): string {
  return path.join(os.homedir(), ".agent", "subagents", "by-parent");
}

export function childSessionIndexPath(parentSessionId: string): string {
  const safe = parentSessionId.replace(/[^\w.-]+/g, "_") || "unknown";
  return path.join(indexDir(), `${safe}.jsonl`);
}

export type ChildSessionLinkRecord = {
  parent_session_id: string;
  parent_session_file: string;
  sub_session_file: string;
  tool_calls?: number;
  ended_at?: string;
  started_at?: string;
  status?: "running" | "done" | "error";
};

function appendRecord(parentSessionId: string, record: ChildSessionLinkRecord): void {
  try {
    fs.mkdirSync(indexDir(), { recursive: true });
    fs.appendFileSync(childSessionIndexPath(parentSessionId), `${JSON.stringify(record)}\n`, "utf8");
  } catch {}
}

export function recordChildSessionStarted(
  parentSessionId: string,
  record: { parentSessionFile: string; childSessionFile: string },
): void {
  appendRecord(parentSessionId, {
    parent_session_id: parentSessionId,
    parent_session_file: record.parentSessionFile,
    sub_session_file: record.childSessionFile,
    started_at: new Date().toISOString(),
    status: "running",
  });
}

export function recordChildSessionFinished(
  parentSessionId: string,
  record: {
    parentSessionFile: string;
    childSessionFile: string;
    toolCalls: number;
    status?: "done" | "error";
  },
): void {
  appendRecord(parentSessionId, {
    parent_session_id: parentSessionId,
    parent_session_file: record.parentSessionFile,
    sub_session_file: record.childSessionFile,
    tool_calls: record.toolCalls,
    ended_at: new Date().toISOString(),
    status: record.status ?? "done",
  });
}
