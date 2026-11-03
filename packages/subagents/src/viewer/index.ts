import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  buildSessionContext,
  parseSessionEntries,
  type SessionEntry,
  type SessionHeader,
} from "@earendil-works/pi-coding-agent";
import { childSessionIndexPath } from "@htwang-contrib/common";

type SubagentLinkRecord = {
  parent_session_id: string;
  parent_session_file: string;
  sub_session_file: string;
  tool_calls: number;
  ended_at: string;
  started_at?: string;
  status?: "running" | "done" | "error";
};

function readLinkRecords(parentSessionId: string): SubagentLinkRecord[] {
  const file = childSessionIndexPath(parentSessionId);
  if (!fs.existsSync(file)) return [];
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const records: SubagentLinkRecord[] = [];
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(s);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const r = parsed as Record<string, unknown>;
    const sub = typeof r.sub_session_file === "string" ? r.sub_session_file : "";
    if (!sub) continue;
    records.push({
      parent_session_id: typeof r.parent_session_id === "string" ? r.parent_session_id : parentSessionId,
      parent_session_file: typeof r.parent_session_file === "string" ? r.parent_session_file : "",
      sub_session_file: sub,
      tool_calls: typeof r.tool_calls === "number" ? r.tool_calls : 0,
      ended_at: typeof r.ended_at === "string" ? r.ended_at : "",
      started_at: typeof r.started_at === "string" ? r.started_at : "",
      status: r.status === "running" || r.status === "done" || r.status === "error" ? r.status : undefined,
    });
  }
  return records;
}

export type SubagentRunSummary = {
  id: string;
  subSessionFile: string;
  toolCalls: number;
  endedAt: string;
  startedAt: string;
  model: string;
  thinking: string;
  cwd: string;
  firstUserText: string;
  label: string;
  running: boolean;
};

function parseChildSession(subSessionFile: string): {
  header?: SessionHeader;
  entries: SessionEntry[];
  messages: AgentMessage[];
} {
  let text: string;
  try {
    text = fs.readFileSync(subSessionFile, "utf8");
  } catch {
    return { entries: [], messages: [] };
  }
  let entries: ReturnType<typeof parseSessionEntries>;
  try {
    entries = parseSessionEntries(text);
  } catch {
    return { entries: [], messages: [] };
  }
  const header = entries.find((e): e is SessionHeader => e.type === "session");
  const sessionEntries = entries.filter((e): e is SessionEntry => e.type !== "session");
  const messages = buildSessionContext(sessionEntries).messages;
  return { header, entries: sessionEntries, messages };
}

function extractFirstUserText(messages: AgentMessage[]): string {
  for (const m of messages) {
    if (m.role !== "user") continue;
    const c = m.content;
    if (typeof c === "string") return c;
    if (!Array.isArray(c)) continue;
    for (const part of c as { type: string; text?: string }[]) {
      if (part.type === "text" && typeof part.text === "string" && part.text) {
        return part.text;
      }
    }
  }
  return "";
}

function trimLabel(text: string, max: number): string {
  const firstLine = text.split("\n")[0] ?? "";
  const clean = firstLine.trim();
  if (!clean) return "";
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1))}…`;
}

export function loadSubagentRuns(parentSessionId: string): SubagentRunSummary[] {
  const records = readLinkRecords(parentSessionId);
  const latestByFile = new Map<string, SubagentLinkRecord>();
  for (const rec of records) {
    latestByFile.set(rec.sub_session_file, rec);
  }
  const out: SubagentRunSummary[] = [];
  for (const rec of latestByFile.values()) {
    const parsed = parseChildSession(rec.sub_session_file);
    if (parsed.messages.length === 0) continue;

    let model = "";
    let thinking = "";
    for (const e of parsed.entries) {
      if (e.type === "model_change") {
        model = `${e.provider}/${e.modelId}`;
      } else if (e.type === "thinking_level_change") {
        thinking = e.thinkingLevel;
      }
    }

    const firstUserText = extractFirstUserText(parsed.messages);
    const label = trimLabel(firstUserText, 64);

    out.push({
      id: path.basename(rec.sub_session_file).replace(/\.jsonl$/i, ""),
      subSessionFile: rec.sub_session_file,
      toolCalls: rec.tool_calls,
      endedAt: rec.ended_at,
      startedAt: rec.started_at || parsed.header?.timestamp || rec.ended_at,
      model,
      thinking,
      cwd: parsed.header?.cwd ?? "",
      firstUserText,
      label,
      running: rec.status === "running",
    });
  }
  out.sort((a, b) => {
    const ta = a.startedAt || a.endedAt || "";
    const tb = b.startedAt || b.endedAt || "";
    if (ta !== tb) return tb.localeCompare(ta);
    return b.subSessionFile.localeCompare(a.subSessionFile);
  });
  return out;
}

export function loadSubagentMessages(subSessionFile: string): AgentMessage[] {
  return parseChildSession(subSessionFile).messages;
}

/** Re-read the by-parent index and return the latest status for a child session
 * file. Used by the live viewer to detect when a running subagent finishes. */
export function refreshRunRunning(parentSessionId: string, subSessionFile: string): { running: boolean } {
  const records = readLinkRecords(parentSessionId);
  let latest: SubagentLinkRecord | undefined;
  for (const rec of records) {
    if (rec.sub_session_file !== subSessionFile) continue;
    latest = rec;
  }
  return { running: latest?.status === "running" };
}
