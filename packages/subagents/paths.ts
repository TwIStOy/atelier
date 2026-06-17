import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const SUBAGENT_SESSION_DIR = path.join(
  os.homedir(),
  ".agent",
  "subagents",
  "session",
);

export function subagentParentIndexDir(): string {
  return path.join(os.homedir(), ".agent", "subagents", "by-parent");
}

export function subagentParentIndexPath(parentSessionId: string): string {
  const safe = parentSessionId.replace(/[^\w.-]+/g, "_") || "unknown";
  return path.join(subagentParentIndexDir(), `${safe}.jsonl`);
}

export type SubagentLinkRecord = {
  parent_session_file: string;
  sub_session_file: string;
  tool_calls?: number;
  ended_at?: string;
  started_at?: string;
  status?: "running" | "done" | "error";
};

function appendLinkRecord(
  parentSessionId: string,
  record: SubagentLinkRecord,
): void {
  try {
    const dir = subagentParentIndexDir();
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      parent_session_id: parentSessionId,
      ...record,
    });
    fs.appendFileSync(subagentParentIndexPath(parentSessionId), `${line}\n`, {
      encoding: "utf8",
    });
  } catch {}
}

/** Append a `running` link record when a child session starts so the viewer
 * picker can surface in-flight subagents before they finish. The child session
 * file is written to disk live by the child SessionManager, so the viewer can
 * then tail it for streaming output. */
export function recordSubagentStarted(
  parentSessionId: string,
  record: {
    parent_session_file: string;
    sub_session_file: string;
  },
): void {
  appendLinkRecord(parentSessionId, {
    parent_session_file: record.parent_session_file,
    sub_session_file: record.sub_session_file,
    started_at: new Date().toISOString(),
    status: "running",
  });
}

export function appendSubagentLinkRecord(
  parentSessionId: string,
  record: {
    parent_session_file: string;
    sub_session_file: string;
    tool_calls: number;
    ended_at: string;
  },
): void {
  appendLinkRecord(parentSessionId, {
    parent_session_file: record.parent_session_file,
    sub_session_file: record.sub_session_file,
    tool_calls: record.tool_calls,
    ended_at: record.ended_at,
    status: "done",
  });
}
