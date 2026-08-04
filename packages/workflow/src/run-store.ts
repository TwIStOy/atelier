import * as fs from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import type { WorkflowAgentCall, WorkflowStatus } from "./engine.ts";

export type WorkflowAgentRecord = {
  seq: number;
  call: WorkflowAgentCall;
  ok: boolean;
  value?: unknown;
  text?: string;
  error?: string;
  endedAt: number;
};

export type WorkflowRunRecord = {
  id: string;
  name: string;
  script: string;
  args?: unknown;
  status: WorkflowStatus;
  startedAt: number;
  endedAt?: number;
  error?: string;
  agents: WorkflowAgentRecord[];
};

const MAX_KEPT_RUNS = 20;

export function workflowRunsDir(home: string = homedir()): string {
  return path.join(home, ".agent", "workflow", "runs");
}

function runRecordPath(id: string, home?: string): string {
  return path.join(workflowRunsDir(home), `${id}.json`);
}

export function writeRunRecord(record: WorkflowRunRecord, home?: string): void {
  const file = runRecordPath(record.id, home);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

export function loadRunRecord(id: string, home?: string): WorkflowRunRecord | undefined {
  const file = runRecordPath(id, home);
  if (!fs.existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as WorkflowRunRecord;
    if (typeof parsed.id !== "string" || !Array.isArray(parsed.agents)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function listRunRecords(limit = MAX_KEPT_RUNS, home?: string): WorkflowRunRecord[] {
  const dir = workflowRunsDir(home);
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const records: WorkflowRunRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const record = loadRunRecord(path.basename(entry, ".json"), home);
    if (record) records.push(record);
  }
  records.sort((a, b) => b.startedAt - a.startedAt);
  return records.slice(0, Math.max(1, limit));
}

export function pruneRunRecords(keep = MAX_KEPT_RUNS, home?: string): void {
  const dir = workflowRunsDir(home);
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  const records: Array<{ id: string; startedAt: number }> = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const id = path.basename(entry, ".json");
    const record = loadRunRecord(id, home);
    if (record) records.push({ id, startedAt: record.startedAt });
  }
  records.sort((a, b) => b.startedAt - a.startedAt);
  for (const stale of records.slice(Math.max(1, keep))) {
    try {
      fs.unlinkSync(runRecordPath(stale.id, home));
    } catch {}
  }
}

export function resumeCheckpoint(agents: WorkflowAgentRecord[]): number {
  const bySeq = new Map<number, WorkflowAgentRecord>();
  for (const record of agents) {
    bySeq.set(record.seq, record);
  }
  let seq = 1;
  while (true) {
    const record = bySeq.get(seq);
    if (!record?.ok) return seq;
    seq += 1;
  }
}

export function callsMatch(a: WorkflowAgentCall, b: WorkflowAgentCall): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
