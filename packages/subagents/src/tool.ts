import type { AgentToolUpdateCallback, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { FALLBACK_PERSONA_ID } from "@htwang-contrib/common/agents/agent-personas";
import { mergeAbortWithTimeoutMs } from "./abort-timeout.ts";
import { buildSubagentAgentCatalog, resolveDispatchAgentId, type SubagentAgentCatalog } from "./agent-catalog.ts";
import { backgroundStartedReply, finalizeBackgroundSuccess, finalizeBackgroundThrown } from "./background-finish.ts";
import { backgroundJobStatusPayload, createBackgroundJob, subagentStatusToolDetails } from "./background-jobs.ts";
import { subagentDetails } from "./details.ts";
import { type ParallelTaskRow, runParallelBatchSubagent } from "./orchestrate-batch.ts";
import { runSingleSubagent } from "./orchestrate-single.ts";
import type { SubagentRunDetails } from "./run-agent.ts";
import { subagentParams, subagentStatusOutputSchema, subagentStatusParams } from "./schemas.ts";
import { readSubagentSettings, type SubagentSettings } from "./settings.ts";
import { drainBackgroundUsage, mergeUsage } from "./usage-report.ts";
import { type TaskShapeParams, validateTaskShape } from "./validate.ts";

type SubagentParams = TaskShapeParams & {
  background?: boolean;
  model?: string;
  thinking?: string;
  inherit_context?: boolean;
  isolated?: boolean;
  max_turns?: number;
  max_concurrent?: number;
  max_total?: number;
  timeout_ms?: number;
};

type ParentBase = {
  parent_session_id: string;
  parent_session_file: string;
};

type RunShared = {
  parentBase: ParentBase;
  parentSessionId: string;
  catalog: SubagentAgentCatalog;
  subagentSettings: SubagentSettings;
  shape: { mode: "single" | "batch" };
  isBackground: boolean;
  baseRunSignal: AbortSignal | undefined;
  runSignal: AbortSignal | undefined;
  onUpdate: AgentToolUpdateCallback<SubagentRunDetails> | undefined;
};

function catalogAgentDescription(catalog: SubagentAgentCatalog, agentId: string): string {
  return catalog.agents.get(agentId)?.fileOptions.description?.trim() ?? "";
}

function resolveBatchAgentId(
  task: ParallelTaskRow,
  globalAgentType: string | undefined,
  catalog: SubagentAgentCatalog,
  settings: SubagentSettings,
): string {
  const dispatch = resolveDispatchAgentId(task.agent_type ?? globalAgentType, catalog, settings);
  return dispatch.ok ? dispatch.id : FALLBACK_PERSONA_ID;
}

function resolveBatchDescription(task: ParallelTaskRow, agentId: string, catalog: SubagentAgentCatalog): string {
  return task.description?.trim() || catalogAgentDescription(catalog, agentId);
}

function fillBatchTaskDescriptions(
  tasks: ParallelTaskRow[],
  catalog: SubagentAgentCatalog,
  globalAgentType: string | undefined,
  settings: SubagentSettings,
): ParallelTaskRow[] {
  return tasks.map((t) => {
    const agentId = resolveBatchAgentId(t, globalAgentType, catalog, settings);
    return { ...t, description: resolveBatchDescription(t, agentId, catalog) };
  });
}

function parentBaseOf(ctx: ExtensionContext): { parentBase: ParentBase; parentSessionId: string } {
  const parentSessionId = ctx.sessionManager.getHeader()?.id ?? "unknown";
  const parentSessionFile = ctx.sessionManager.getSessionFile() ?? "";
  return {
    parentSessionId,
    parentBase: {
      parent_session_id: parentSessionId,
      parent_session_file: parentSessionFile,
    },
  };
}

function resolveRunSignals(
  signal: AbortSignal | undefined,
  ctxSignal: AbortSignal | undefined,
  isBackground: boolean,
  timeoutMs: number,
): { baseRunSignal: AbortSignal | undefined; runSignal: AbortSignal | undefined } {
  const merged = signal ? (ctxSignal ? AbortSignal.any([signal, ctxSignal]) : signal) : ctxSignal;
  const baseRunSignal = isBackground ? ctxSignal : merged;
  return { baseRunSignal, runSignal: mergeAbortWithTimeoutMs(baseRunSignal, timeoutMs) };
}

function noModelReply(parentBase: ParentBase) {
  return {
    content: [
      {
        type: "text" as const,
        text: "subagent: parent session has no active model; select a model first.",
      },
    ],
    details: subagentDetails({
      ...parentBase,
      tool_calls: 0,
    }),
  };
}

function batchLimitReply(parentBase: ParentBase, taskCount: number, maxTotal: number) {
  return {
    content: [
      {
        type: "text" as const,
        text: `subagent: ${taskCount} tasks exceeds max_total (${maxTotal}). Raise max_total in ~/.agent/subagents/settings.json or pass max_total on this call.`,
      },
    ],
    details: subagentDetails({
      ...parentBase,
      tool_calls: 0,
      mode: "batch" as const,
      batch: [],
      ok: false,
      error: `Too many tasks (${taskCount} > ${maxTotal}).`,
    }),
  };
}

function batchRunArgs(
  params: SubagentParams,
  shared: RunShared,
  tasks: ParallelTaskRow[],
  limits: { maxConcurrent: number; maxTotal: number },
) {
  return {
    tasks,
    parentBase: shared.parentBase,
    merged: shared.baseRunSignal,
    subagentSettings: shared.subagentSettings,
    onUpdate: shared.onUpdate,
    globalModel: params.model,
    globalThinking: params.thinking,
    globalInherit: params.inherit_context,
    globalIsolated: params.isolated,
    globalMaxTurns: params.max_turns,
    globalAgentType: params.agent_type,
    limits,
  };
}

function startBackgroundBatch(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  params: SubagentParams,
  shared: RunShared,
  tasks: ParallelTaskRow[],
  limits: { maxConcurrent: number; maxTotal: number },
) {
  const label = `batch (${tasks.length} tasks)`;
  const jobId = createBackgroundJob({ mode: "batch", label });
  void runParallelBatchSubagent(ctx, batchRunArgs(params, shared, tasks, limits))
    .then((r) => finalizeBackgroundSuccess(pi, ctx, jobId, label, "batch", r))
    .catch((e) => finalizeBackgroundThrown(pi, ctx, jobId, label, "batch", e));
  return backgroundStartedReply(shared.parentBase, shared.shape, jobId);
}

async function runBatchPhase(pi: ExtensionAPI, ctx: ExtensionContext, params: SubagentParams, shared: RunShared) {
  const limits = {
    maxConcurrent: shared.subagentSettings.maxConcurrent,
    maxTotal: shared.subagentSettings.maxTotal,
  };
  const tasks = fillBatchTaskDescriptions(
    params.tasks as ParallelTaskRow[],
    shared.catalog,
    params.agent_type,
    shared.subagentSettings,
  );
  if (tasks.length > limits.maxTotal) {
    return batchLimitReply(shared.parentBase, tasks.length, limits.maxTotal);
  }

  if (shared.isBackground) {
    return startBackgroundBatch(pi, ctx, params, shared, tasks, limits);
  }

  const batchResult = await runParallelBatchSubagent(ctx, batchRunArgs(params, shared, tasks, limits));
  const batchUsage = mergeUsage(batchResult.usage, drainBackgroundUsage(shared.parentSessionId));
  return { ...batchResult, ...(batchUsage ? { usage: batchUsage } : {}) };
}

function singleRunArgs(params: SubagentParams, shared: RunShared, description: string, withUpdates: boolean) {
  return {
    task: params.task!.trim(),
    description,
    parentBase: shared.parentBase,
    merged: shared.runSignal,
    subagentSettings: shared.subagentSettings,
    ...(withUpdates ? { onUpdate: shared.onUpdate } : {}),
    globalModel: params.model,
    globalThinking: params.thinking,
    globalInherit: params.inherit_context,
    globalIsolated: params.isolated,
    globalMaxTurns: params.max_turns,
    globalAgentType: params.agent_type,
  };
}

function startBackgroundSingle(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  params: SubagentParams,
  shared: RunShared,
  description: string,
) {
  const jobId = createBackgroundJob({
    mode: "single",
    label: description,
  });
  void runSingleSubagent(ctx, singleRunArgs(params, shared, description, false))
    .then((r) => finalizeBackgroundSuccess(pi, ctx, jobId, description, "single", r))
    .catch((e) => finalizeBackgroundThrown(pi, ctx, jobId, description, "single", e));
  return backgroundStartedReply(shared.parentBase, shared.shape, jobId);
}

function resolveSingleDescription(
  params: SubagentParams,
  catalog: SubagentAgentCatalog,
  settings: SubagentSettings,
): string {
  const dispatch = resolveDispatchAgentId(params.agent_type, catalog, settings);
  const agentId = dispatch.ok ? dispatch.id : FALLBACK_PERSONA_ID;
  return params.description?.trim() || catalogAgentDescription(catalog, agentId);
}

async function runSinglePhase(pi: ExtensionAPI, ctx: ExtensionContext, params: SubagentParams, shared: RunShared) {
  const description = resolveSingleDescription(params, shared.catalog, shared.subagentSettings);
  if (shared.isBackground) {
    return startBackgroundSingle(pi, ctx, params, shared, description);
  }

  const singleResult = await runSingleSubagent(ctx, singleRunArgs(params, shared, description, true));
  const singleUsage = mergeUsage(singleResult.usage, drainBackgroundUsage(shared.parentSessionId));
  return { ...singleResult, ...(singleUsage ? { usage: singleUsage } : {}) };
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
      const { parentBase, parentSessionId } = parentBaseOf(ctx);

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
        return noModelReply(parentBase);
      }

      const isBackground = params.background === true;
      const { baseRunSignal, runSignal } = resolveRunSignals(
        signal,
        ctx.signal,
        isBackground,
        subagentSettings.timeoutMs,
      );
      const shared: RunShared = {
        parentBase,
        parentSessionId,
        catalog,
        subagentSettings,
        shape,
        isBackground,
        baseRunSignal,
        runSignal,
        onUpdate,
      };

      if (shape.mode === "batch" && params.tasks) {
        return runBatchPhase(pi, ctx, params, shared);
      }
      return runSinglePhase(pi, ctx, params, shared);
    },
  });
}
