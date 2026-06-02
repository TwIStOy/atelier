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
import {
  buildSubagentAgentCatalog,
  resolveSubagentAgentId,
  type SubagentAgentCatalog,
} from "./agent-catalog.ts";
import { readSubagentSettings, type SubagentSettings } from "./settings.ts";

function fillBatchTaskDescriptions(
  tasks: ParallelTaskRow[],
  catalog: SubagentAgentCatalog,
  globalAgentType: string | undefined,
): ParallelTaskRow[] {
  return tasks.map((t) => {
    const aid = resolveSubagentAgentId(
      t.agent_type ?? globalAgentType,
      catalog,
    );
    const description =
      t.description?.trim() ||
      catalog.agents.get(aid)?.fileOptions.description?.trim() ||
      "";
    return { ...t, description };
  });
}

export function registerSubagentStatusTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent_status",
    label: "Subagent status",
    description:
      "JSON status for a background `subagent` job: pass `id` from `subagent` with `background: true`.",
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
      "Run child Pi agent work in-process (no extra `pi` process). Single: `task` and optional `description` (or use persona frontmatter `description`). Parallel: `tasks` with optional per-task `description` when the persona file sets it. Tool parameters override persona Markdown frontmatter defaults (`model`, `thinking`, `inherit_context`, `isolated`, `max_turns`, `description`). With `background: true`, returns an `id`—poll `subagent_status`. Optional: `timeout_ms`, `agent_type`, `max_concurrent`, `max_total`.",
    parameters: subagentParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getHeader()?.id ?? "unknown";
      const parentSessionFile = ctx.sessionManager.getSessionFile() ?? "";
      const parentBase = {
        parent_session_id: parentSessionId,
        parent_session_file: parentSessionFile,
      };

      const catalog = buildSubagentAgentCatalog(ctx.cwd);
      const shape = validateTaskShape(params, catalog);
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
      const globalInherit = params.inherit_context;
      const globalIsolated = params.isolated;
      const globalMaxTurns = params.max_turns;
      const globalAgentType = params.agent_type;

      if (shape.mode === "batch" && params.tasks) {
        const limits = {
          maxConcurrent: subagentSettings.maxConcurrent,
          maxTotal: subagentSettings.maxTotal,
        };
        const tasks = fillBatchTaskDescriptions(
          params.tasks as ParallelTaskRow[],
          catalog,
          params.agent_type,
        );
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

      const singleAgentId = resolveSubagentAgentId(params.agent_type, catalog);
      const singleDescription =
        params.description?.trim() ||
        catalog.agents.get(singleAgentId)?.fileOptions.description?.trim() ||
        "";
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
