import { randomUUID } from "node:crypto";

export type BackgroundJobStatus = "running" | "done" | "error";

export type BackgroundJobSnapshot = {
  id: string;
  status: BackgroundJobStatus;
  mode: "single" | "batch";
  label: string;
  created_at: number;
  updated_at: number;
  ok?: boolean;
  error?: string;
  summary?: string;
  tool_calls?: number;
  batch_counts?: { ok: number; err: number };
};

const MAX_JOBS = 256;
const jobs = new Map<string, BackgroundJobSnapshot>();

function pruneIfNeeded() {
  if (jobs.size < MAX_JOBS) return;
  const finished = [...jobs.entries()].filter(([, v]) => v.status === "done" || v.status === "error");
  finished.sort((a, b) => a[1].updated_at - b[1].updated_at);
  const over = jobs.size - MAX_JOBS + 48;
  for (let i = 0; i < Math.min(over, finished.length); i++) {
    jobs.delete(finished[i]![0]);
  }
}

export function createBackgroundJob(input: { mode: "single" | "batch"; label: string }): string {
  pruneIfNeeded();
  const id = randomUUID();
  const now = Date.now();
  jobs.set(id, {
    id,
    status: "running",
    mode: input.mode,
    label: input.label,
    created_at: now,
    updated_at: now,
  });
  return id;
}

export function updateBackgroundJob(
  id: string,
  patch: Partial<Omit<BackgroundJobSnapshot, "id" | "created_at" | "mode" | "label">>,
) {
  const j = jobs.get(id);
  if (!j) return;
  jobs.set(id, {
    ...j,
    ...patch,
    updated_at: Date.now(),
  });
}

export function getBackgroundJob(id: string): BackgroundJobSnapshot | undefined {
  return jobs.get(id);
}

export function backgroundJobStatusPayload(id: string): unknown {
  const j = jobs.get(id);
  if (!j) {
    return {
      status: "unknown",
      id,
      message: "No background subagent with this id (wrong id or pruned after many newer jobs).",
    };
  }
  if (j.status === "running") {
    return {
      status: "running",
      id: j.id,
      mode: j.mode,
      label: j.label,
      created_at: j.created_at,
      updated_at: j.updated_at,
    };
  }
  return {
    status: j.status,
    id: j.id,
    mode: j.mode,
    label: j.label,
    created_at: j.created_at,
    updated_at: j.updated_at,
    ok: j.ok,
    error: j.error,
    summary: j.summary,
    tool_calls: j.tool_calls,
    batch_counts: j.batch_counts,
  };
}

export type SubagentStatusToolDetails = {
  job_id: string;
  known: boolean;
  status: string;
  mode?: "single" | "batch";
  label?: string;
  ok?: boolean;
  error?: string;
  tool_calls?: number;
  batch_counts?: { ok: number; err: number };
  message?: string;
};

export function subagentStatusToolDetails(id: string, payload: unknown): SubagentStatusToolDetails {
  const p = (payload ?? {}) as Record<string, unknown>;
  const status = typeof p.status === "string" ? p.status : "unknown";
  const known = status !== "unknown";
  const bc = p.batch_counts;
  let batch_counts: { ok: number; err: number } | undefined;
  if (
    bc &&
    typeof bc === "object" &&
    !Array.isArray(bc) &&
    typeof (bc as { ok?: unknown }).ok === "number" &&
    typeof (bc as { err?: unknown }).err === "number"
  ) {
    batch_counts = {
      ok: (bc as { ok: number }).ok,
      err: (bc as { err: number }).err,
    };
  }
  return {
    job_id: id,
    known,
    status,
    mode: p.mode === "single" || p.mode === "batch" ? p.mode : undefined,
    label: typeof p.label === "string" ? p.label : undefined,
    ok: typeof p.ok === "boolean" ? p.ok : undefined,
    error: typeof p.error === "string" ? p.error : undefined,
    tool_calls: typeof p.tool_calls === "number" ? p.tool_calls : undefined,
    batch_counts,
    message: typeof p.message === "string" ? p.message : undefined,
  };
}
