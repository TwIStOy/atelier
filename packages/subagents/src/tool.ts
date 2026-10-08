import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { FALLBACK_PERSONA_ID } from "@htwang-contrib/common";
import { mergeAbortWithTimeoutMs } from "./abort-timeout.ts";
import { buildSubagentAgentCatalog, resolveDispatchAgentId, type SubagentAgentCatalog } from "./agent-catalog.ts";
import { backgroundStartedReply, finalizeBackgroundSuccess, finalizeBackgroundThrown } from "./background-finish.ts";
import { backgroundJobStatusPayload, createBackgroundJob, subagentStatusToolDetails } from "./background-jobs.ts";
import { subagentDetails } from "./details.ts";
import { type ParallelTaskRow, runParallelBatchSubagent } from "./orchestrate-batch.ts";
import { runSingleSubagent } from "./orchestrate-single.ts";
import { subagentParams, subagentStatusOutputSchema, subagentStatusParams } from "./schemas.ts";
import { readSubagentSettings, type SubagentSettings } from "./settings.ts";
import { drainBackgroundUsage, mergeUsage } from "./usage-report.ts";
import { validateTaskShape } from "./validate.ts";

function fillBatchTaskDescriptions(
  tasks: ParallelTaskRow[],
  catalog: SubagentAgentCatalog,
  globalAgentType: string | undefined,
  settings: SubagentSettings,
): ParallelTaskRow[] {
  return tasks.map((t) => {
    const dispatch = resolveDispatchAgentId(t.agent_type ?? globalAgentType, catalog, settings);
    const aid = dispatch.ok ? dispatch.id : FALLBACK_PERSONA_ID;
    const description = t.description?.trim() || catalog.agents.get(aid)?.fileOptions.description?.trim() || "";
    return { ...t, description };
  });
}

export function registerSubagentStatusTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent_status",
    label: "Subagent status",
    description: "Read status for a background subagent job.",
    parameters: subagentStatusParams,
    annotations: { readOnlyHint: true },
    outputSchema: subagentStatusOutputSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const id = params.id.trim();
      const payload = backgroundJobStatusPayload(id);
      const usage = drainBackgroundUsage(ctx.sessionManager.getHeader()?.id ?? "unknown");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
          },
        ],
        details: subagentStatusToolDetails(id, payload),
        structuredContent: payload,
        ...(usage ? { usage } : {}),
      };
    },
  });
}

export function registerSubagentTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description: "Run a child agent in-process; returns its reply or starts a background job.",
    parameters: subagentParams,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const parentSessionId = ctx.sessionManager.getHeader()?.id ?? "unknown";
      const parentSessionFile = ctx.sessionManager.getSessionFile() ?? "";
      const parentBase = {
        parent_session_id: parentSessionId,
        parent_session_file: parentSessionFile,
      };

      const catalog = buildSubagentAgentCatalog(ctx.cwd);
      for (const warning of catalog.warnings) {
        ctx.ui.notify(warning, "warning");
      }
      const subagentSettings: SubagentSettings = readSubagentSettings({
        max_concurrent: params.max_concurrent,
        max_total: params.max_total,
        timeout_ms: params.timeout_ms,
      });
      const shape = validateTaskShape(params, catalog, subagentSettings);
      if (!shape.ok) {
        throw new Error(shape.message);
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

      const merged = signal ? (ctx.signal ? AbortSignal.any([signal, ctx.signal]) : signal) : ctx.signal;

      const bgSignal = ctx.signal;
      const isBackground = params.background === true;
      const baseRunSignal = isBackground ? bgSignal : merged;

      const runSignal = mergeAbortWithTimeoutMs(baseRunSignal, subagentSettings.timeoutMs);

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
          subagentSettings,
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
            .then((r) => finalizeBackgroundSuccess(pi, ctx, jobId, label, "batch", r))
            .catch((e) => finalizeBackgroundThrown(pi, ctx, jobId, label, "batch", e));
          return backgroundStartedReply(parentBase, shape, jobId);
        }

        const batchResult = await runParallelBatchSubagent(ctx, {
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
        const batchUsage = mergeUsage(batchResult.usage, drainBackgroundUsage(parentSessionId));
        return { ...batchResult, ...(batchUsage ? { usage: batchUsage } : {}) };
      }

      const singleDispatch = resolveDispatchAgentId(params.agent_type, catalog, subagentSettings);
      const singleAgentId = singleDispatch.ok ? singleDispatch.id : FALLBACK_PERSONA_ID;
      const singleDescription =
        params.description?.trim() || catalog.agents.get(singleAgentId)?.fileOptions.description?.trim() || "";
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
          .then((r) => finalizeBackgroundSuccess(pi, ctx, jobId, singleDescription, "single", r))
          .catch((e) => finalizeBackgroundThrown(pi, ctx, jobId, singleDescription, "single", e));
        return backgroundStartedReply(parentBase, shape, jobId);
      }

      const singleResult = await runSingleSubagent(ctx, {
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
      const singleUsage = mergeUsage(singleResult.usage, drainBackgroundUsage(parentSessionId));
      return { ...singleResult, ...(singleUsage ? { usage: singleUsage } : {}) };
    },
  });
}
