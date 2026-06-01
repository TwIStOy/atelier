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

export function appendSubagentLinkRecord(
  parentSessionId: string,
  record: {
    parent_session_file: string;
    sub_session_file: string;
    tool_calls: number;
    ended_at: string;
  },
): void {
  try {
    const dir = subagentParentIndexDir();
    fs.mkdirSync(dir, { recursive: true });
    const line = JSON.stringify({
      parent_session_id: parentSessionId,
      ...record,
    });
    fs.appendFileSync(subagentParentIndexPath(parentSessionId), `${line}\n`, {
      encoding: "utf-8",
    });
  } catch {}
}
