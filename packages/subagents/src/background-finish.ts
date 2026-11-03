import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateDisplay } from "@htwang-contrib/common";
import { updateBackgroundJob } from "./background-jobs.ts";
import { subagentDetails } from "./details.ts";
import { SUBAGENT_EVENTS } from "./events.ts";
import type { SubagentRunDetails } from "./run-agent.ts";
import { drainBackgroundUsage, poolBackgroundUsage } from "./usage-report.ts";

function resultText(r: { content: Array<{ type: "text"; text: string }> }): string {
  const first = r.content[0];
  return first?.type === "text" && typeof first.text === "string" ? first.text : "";
}

function finishSummary(text: string): string {
  return text.length > 12_000 ? `${text.slice(0, 12_000)}\n…` : text;
}

function batchCountsOf(mode: "single" | "batch", details: SubagentRunDetails): { ok: number; err: number } | undefined {
  if (mode !== "batch" || !details.batch) return undefined;
  return details.batch.reduce(
    (acc, b) => {
      if (b.ok) acc.ok += 1;
      else acc.err += 1;
      return acc;
    },
    { ok: 0, err: 0 },
  );
}

function notifyFinished(ctx: ExtensionContext, ok: boolean, mode: "single" | "batch", label: string): void {
  const short = truncateDisplay(label, 64);
  const msg = ok
    ? `Subagent done: ${short}`
    : mode === "batch"
      ? `Subagent batch finished with errors: ${short}`
      : `Subagent failed: ${short}`;
  ctx.ui.notify(msg, ok ? "info" : "error");
}

export function finalizeBackgroundSuccess(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  jobId: string,
  label: string,
  mode: "single" | "batch",
  r: {
    content: Array<{ type: "text"; text: string }>;
    details: SubagentRunDetails;
  },
) {
  const summary = finishSummary(resultText(r));
  const ok = r.details.ok !== false;
  if (r.details.parent_session_id) {
    poolBackgroundUsage(r.details.parent_session_id, r.details);
  }
  const batchCounts = batchCountsOf(mode, r.details);
  updateBackgroundJob(jobId, {
    status: "done",
    ok,
    error: r.details.error,
    summary,
    tool_calls: r.details.tool_calls,
    batch_counts: batchCounts,
  });
  pi.events.emit(SUBAGENT_EVENTS.COMPLETE, {
    id: jobId,
    ok,
    mode,
    label,
    error: r.details.error,
    tool_calls: r.details.tool_calls,
    batch_counts: batchCounts,
  });
  notifyFinished(ctx, ok, mode, label);
}

export function finalizeBackgroundThrown(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  jobId: string,
  label: string,
  mode: "single" | "batch",
  err: unknown,
) {
  const msg = err instanceof Error ? err.message : String(err);
  updateBackgroundJob(jobId, {
    status: "error",
    ok: false,
    error: msg,
    summary: msg,
  });
  pi.events.emit(SUBAGENT_EVENTS.COMPLETE, {
    id: jobId,
    ok: false,
    mode,
    label,
    error: msg,
  });
  ctx.ui.notify(`Subagent crashed (${truncateDisplay(label, 48)}): ${truncateDisplay(msg, 160)}`, "error");
}

export function backgroundStartedReply(
  parentBase: {
    parent_session_id: string;
    parent_session_file: string;
  },
  shape: { mode: "single" | "batch" },
  id: string,
): {
  content: Array<{ type: "text"; text: string }>;
  details: SubagentRunDetails;
  usage?: Usage;
} {
  const msg = `Background subagent started. id=${id}\nPoll with tool subagent_status and { "id": "${id}" }.`;
  const usage = drainBackgroundUsage(parentBase.parent_session_id);
  return {
    content: [{ type: "text", text: msg }],
    details: subagentDetails({
      ...parentBase,
      tool_calls: 0,
      mode: shape.mode,
      background: true,
      background_id: id,
    }),
    ...(usage ? { usage } : {}),
  };
}
