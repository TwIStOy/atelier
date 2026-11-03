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

function readIndexText(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function asRecord(parsed: unknown): Record<string, unknown> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

function strOr(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function parseStatus(v: unknown): "running" | "done" | "error" | undefined {
  return v === "running" || v === "done" || v === "error" ? v : undefined;
}

function toLinkRecord(r: Record<string, unknown>, parentSessionId: string): SubagentLinkRecord | null {
  const sub = strOr(r.sub_session_file, "");
  if (!sub) return null;
  return {
    parent_session_id: strOr(r.parent_session_id, parentSessionId),
    parent_session_file: strOr(r.parent_session_file, ""),
    sub_session_file: sub,
    tool_calls: typeof r.tool_calls === "number" ? r.tool_calls : 0,
    ended_at: strOr(r.ended_at, ""),
    started_at: strOr(r.started_at, ""),
    status: parseStatus(r.status),
  };
}

function parseLinkLine(line: string, parentSessionId: string): SubagentLinkRecord | null {
  const s = line.trim();
  if (!s) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return null;
  }
  const r = asRecord(parsed);
  if (!r) return null;
  return toLinkRecord(r, parentSessionId);
}

function readLinkRecords(parentSessionId: string): SubagentLinkRecord[] {
  const text = readIndexText(childSessionIndexPath(parentSessionId));
  if (text === null) return [];
  const records: SubagentLinkRecord[] = [];
  for (const line of text.split("\n")) {
    const rec = parseLinkLine(line, parentSessionId);
    if (rec) records.push(rec);
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

function modelThinkingOf(entries: SessionEntry[]): { model: string; thinking: string } {
  let model = "";
  let thinking = "";
  for (const e of entries) {
    if (e.type === "model_change") {
      model = `${e.provider}/${e.modelId}`;
    } else if (e.type === "thinking_level_change") {
      thinking = e.thinkingLevel;
    }
  }
  return { model, thinking };
}

function startedAtOf(rec: SubagentLinkRecord, parsed: ReturnType<typeof parseChildSession>): string {
  return rec.started_at || parsed.header?.timestamp || rec.ended_at;
}

function summarizeRecord(rec: SubagentLinkRecord): SubagentRunSummary | null {
  const parsed = parseChildSession(rec.sub_session_file);
  if (parsed.messages.length === 0) return null;
  const { model, thinking } = modelThinkingOf(parsed.entries);
  const firstUserText = extractFirstUserText(parsed.messages);
  return {
    id: path.basename(rec.sub_session_file).replace(/\.jsonl$/i, ""),
    subSessionFile: rec.sub_session_file,
    toolCalls: rec.tool_calls,
    endedAt: rec.ended_at,
    startedAt: startedAtOf(rec, parsed),
    model,
    thinking,
    cwd: parsed.header?.cwd ?? "",
    firstUserText,
    label: trimLabel(firstUserText, 64),
    running: rec.status === "running",
  };
}

function runStartedKey(run: SubagentRunSummary): string {
  return run.startedAt || run.endedAt || "";
}

function compareRuns(a: SubagentRunSummary, b: SubagentRunSummary): number {
  const ta = runStartedKey(a);
  const tb = runStartedKey(b);
  if (ta !== tb) return tb.localeCompare(ta);
  return b.subSessionFile.localeCompare(a.subSessionFile);
}

export function loadSubagentRuns(parentSessionId: string): SubagentRunSummary[] {
  const records = readLinkRecords(parentSessionId);
  const latestByFile = new Map<string, SubagentLinkRecord>();
  for (const rec of records) {
    latestByFile.set(rec.sub_session_file, rec);
  }
  const out: SubagentRunSummary[] = [];
  for (const rec of latestByFile.values()) {
    const summary = summarizeRecord(rec);
    if (summary) out.push(summary);
  }
  out.sort(compareRuns);
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
