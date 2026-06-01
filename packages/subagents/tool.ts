import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createBackgroundJob,
  backgroundJobStatusPayload,
  subagentStatusToolDetails,
} from "./background-jobs.ts";
import {
  backgroundStartedReply,
  finalizeBackgroundSuccess,
  finalizeBackgroundThrown,
} from "./background-finish.ts";
import { subagentDetails } from "./details.ts";
import {
  runParallelBatchSubagent,
  type ParallelTaskRow,
} from "./orchestrate-batch.ts";
import { runSingleSubagent } from "./orchestrate-single.ts";
import { subagentParams, subagentStatusParams } from "./schemas.ts";
import { validateTaskShape } from "./validate.ts";
import { mergeAbortWithTimeoutMs } from "./abort-timeout.ts";
import { readSubagentSettings, type SubagentSettings } from "./settings.ts";

export function registerSubagentStatusTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent_status",
    label: "Subagent status",
    description:
      "Returns JSON status for a background subagent job: pass `id` from a `subagent` call with `background: true`. States: running, done (includes partial batch failures via ok and batch_counts), error (unhandled exception), unknown (expired id).",
    parameters: subagentStatusParams,
    async execute(_toolCallId, params) {
      const id = params.id.trim();
      const payload = backgroundJobStatusPayload(id);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
          },
        ],
        details: subagentStatusToolDetails(id, payload),
      };
    },
  });
}

export function registerSubagentTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Runs one or more in-process Pi AgentSession values (no extra pi OS process). Single mode: non-empty `task` plus required `description` (short tree label). Parallel mode: `tasks` array, each item with required `description`; runs up to `max_concurrent` at a time (defaults from ~/.agent/subagents/settings.json, built-in 3 concurrent / 10 total if file absent). Optional `background: true` returns immediately with an `id`; poll with `subagent_status`. Optional `timeout_ms` merges a wall-clock abort with parent cancellation. On completion, emits `subagent:complete` on `pi.events` and shows `ctx.ui.notify`. Optional `agent_type` selects the injected system prompt (default, research, review, plan). When some tasks fail, the tool still returns 200-style success with a per-task summary: failed tasks appear under `### Task N — error` and `details.batch[].ok === false`. Sessions persist under ~/.agent/subagents/session; linkage lines append under ~/.agent/subagents/by-parent/<parent_id>.jsonl. Default tools are read-only unless `isolated=false`; child sessions never receive `subagent` or `subagent_status`.",
    parameters: subagentParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getHeader()?.id ?? "unknown";
      const parentSessionFile = ctx.sessionManager.getSessionFile() ?? "";
      const parentBase = {
        parent_session_id: parentSessionId,
        parent_session_file: parentSessionFile,
      };

      const shape = validateTaskShape(params);
      if (!shape.ok) {
        return {
          content: [{ type: "text", text: shape.message }],
          details: subagentDetails({
            ...parentBase,
            tool_calls: 0,
          }),
        };
      }

      if (!ctx.model) {
        return {
          content: [
            {
              type: "text",
              text: "subagent: parent session has no active model; select a model first.",
            },
          ],
          details: subagentDetails({
            ...parentBase,
            tool_calls: 0,
          }),
        };
      }

      const merged = signal
        ? ctx.signal
          ? AbortSignal.any([signal, ctx.signal])
          : signal
        : ctx.signal;

      const bgSignal = ctx.signal;
      const isBackground = params.background === true;
      const baseRunSignal = isBackground ? bgSignal : merged;

      const subagentSettings: SubagentSettings = readSubagentSettings({
        max_concurrent: params.max_concurrent,
        max_total: params.max_total,
        timeout_ms: params.timeout_ms,
      });
      const runSignal = mergeAbortWithTimeoutMs(
        baseRunSignal,
        subagentSettings.timeoutMs,
      );

      const globalModel = params.model;
      const globalThinking = params.thinking;
      const globalInherit = params.inherit_context === true;
      const globalIsolated = params.isolated !== false;
      const globalMaxTurns = params.max_turns;
      const globalAgentType = params.agent_type;

      if (shape.mode === "batch" && params.tasks) {
        const limits = {
          maxConcurrent: subagentSettings.maxConcurrent,
          maxTotal: subagentSettings.maxTotal,
        };
        const tasks = params.tasks as ParallelTaskRow[];
        if (tasks.length > limits.maxTotal) {
          return {
            content: [
              {
                type: "text",
                text: `subagent: ${tasks.length} tasks exceeds max_total (${limits.maxTotal}). Raise max_total in ~/.agent/subagents/settings.json or pass max_total on this call.`,
              },
            ],
            details: subagentDetails({
              ...parentBase,
              tool_calls: 0,
              mode: "batch",
              batch: [],
              ok: false,
              error: `Too many tasks (${tasks.length} > ${limits.maxTotal}).`,
            }),
          };
        }

        if (isBackground) {
          const label = `batch (${tasks.length} tasks)`;
          const jobId = createBackgroundJob({ mode: "batch", label });
          void runParallelBatchSubagent(ctx, {
            tasks,
            parentBase,
            merged: baseRunSignal,
            subagentSettings,
            onUpdate,
            globalModel,
            globalThinking,
            globalInherit,
            globalIsolated,
            globalMaxTurns,
            globalAgentType,
            limits,
          })
            .then((r) =>
              finalizeBackgroundSuccess(pi, ctx, jobId, label, "batch", r),
            )
            .catch((e) =>
              finalizeBackgroundThrown(pi, ctx, jobId, label, "batch", e),
            );
          return backgroundStartedReply(parentBase, shape, jobId);
        }

        return runParallelBatchSubagent(ctx, {
          tasks,
          parentBase,
          merged: baseRunSignal,
          subagentSettings,
          onUpdate,
          globalModel,
          globalThinking,
          globalInherit,
          globalIsolated,
          globalMaxTurns,
          globalAgentType,
          limits,
        });
      }

      const singleDescription = params.description!.trim();
      if (isBackground) {
        const jobId = createBackgroundJob({
          mode: "single",
          label: singleDescription,
        });
        void runSingleSubagent(ctx, {
          task: params.task!.trim(),
          description: singleDescription,
          parentBase,
          merged: runSignal,
          subagentSettings,
          globalModel,
          globalThinking,
          globalInherit,
          globalIsolated,
          globalMaxTurns,
          globalAgentType,
        })
          .then((r) =>
            finalizeBackgroundSuccess(
              pi,
              ctx,
              jobId,
              singleDescription,
              "single",
              r,
            ),
          )
          .catch((e) =>
            finalizeBackgroundThrown(
              pi,
              ctx,
              jobId,
              singleDescription,
              "single",
              e,
            ),
          );
        return backgroundStartedReply(parentBase, shape, jobId);
      }

      return runSingleSubagent(ctx, {
        task: params.task!.trim(),
        description: singleDescription,
        parentBase,
        merged: runSignal,
        subagentSettings,
        onUpdate,
        globalModel,
        globalThinking,
        globalInherit,
        globalIsolated,
        globalMaxTurns,
        globalAgentType,
      });
    },
  });
}
