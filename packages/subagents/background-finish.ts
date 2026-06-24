import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateDisplay } from "@htwang-contrib/common";
import { updateBackgroundJob } from "./background-jobs.ts";
import { subagentDetails } from "./details.ts";
import { SUBAGENT_EVENTS } from "./events.ts";
import type { SubagentRunDetails } from "./run-agent.ts";

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
  const text = r.content[0]?.type === "text" && typeof r.content[0].text === "string" ? r.content[0].text : "";
  const summary = text.length > 12_000 ? `${text.slice(0, 12_000)}\n…` : text;
  const ok = r.details.ok !== false;
  const batchCounts =
    mode === "batch" && r.details.batch
      ? r.details.batch.reduce(
          (acc, b) => {
            if (b.ok) acc.ok += 1;
            else acc.err += 1;
            return acc;
          },
          { ok: 0, err: 0 },
        )
      : undefined;
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
  const short = truncateDisplay(label, 64);
  const msg = ok
    ? `Subagent done: ${short}`
    : mode === "batch"
      ? `Subagent batch finished with errors: ${short}`
      : `Subagent failed: ${short}`;
  ctx.ui.notify(msg, ok ? "info" : "error");
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
} {
  const msg = `Background subagent started. id=${id}\nPoll with tool subagent_status and { "id": "${id}" }.`;
  return {
    content: [{ type: "text", text: msg }],
    details: subagentDetails({
      ...parentBase,
      tool_calls: 0,
      mode: shape.mode,
      background: true,
      background_id: id,
    }),
  };
}
