import type { Usage } from "@earendil-works/pi-ai";
import type { AgentToolUpdateCallback, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { type AgentPersonaFileOptions, mapConcurrent } from "@htwang-contrib/common";
import { mergeAbortWithTimeoutMs } from "./abort-timeout.ts";
import { buildSubagentAgentCatalog, resolveDispatchAgentId, resolveSubagentAgentId } from "./agent-catalog.ts";
import { formatBatchToolText } from "./batch-text.ts";
import { subagentDetails } from "./details.ts";
import { tryParentToolUpdate, withThrottledParentFlush } from "./parent-update.ts";
import {
  type RunSubAgentResult,
  runSubAgent,
  type SubagentBatchItemDetail,
  type SubagentChildProgress,
  type SubagentRunDetails,
} from "./run-agent.ts";
import {
  defaultsForAgentType,
  resolveTimeoutMs,
  type SubagentAgentTypeDefaults,
  type SubagentSettings,
} from "./settings.ts";
import { toPiUsage } from "./usage-report.ts";

export type ParallelTaskRow = {
  task: string;
  description: string;
  model?: string;
  thinking?: string;
  inherit_context?: boolean;
  isolated?: boolean;
  max_turns?: number;
  timeout_ms?: number;
  agent_type?: string;
};

export async function runParallelBatchSubagent(
  ctx: ExtensionContext,
  args: {
    tasks: ParallelTaskRow[];
    parentBase: {
      parent_session_id: string;
      parent_session_file: string;
    };
    merged: AbortSignal | undefined;
    subagentSettings: SubagentSettings;
    onUpdate: AgentToolUpdateCallback<SubagentRunDetails> | undefined;
    globalModel?: string;
    globalThinking?: string;
    globalInherit: boolean | undefined;
    globalIsolated: boolean | undefined;
    globalMaxTurns?: number;
    globalAgentType?: string;
    limits: { maxConcurrent: number; maxTotal: number };
  },
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  details: SubagentRunDetails;
  usage?: Usage;
}> {
  const {
    tasks,
    parentBase,
    merged,
    subagentSettings,
    onUpdate,
    globalModel,
    globalThinking,
    globalInherit,
    globalIsolated,
    globalMaxTurns,
    globalAgentType,
    limits,
  } = args;
  const catalog = buildSubagentAgentCatalog(ctx.cwd);
  const n = tasks.length;
  const perTaskTools = Array.from({ length: n }, () => 0);
  const perTaskStarted = Array.from({ length: n }, () => false);
  const perTaskDone = Array.from({ length: n }, () => false);
  const perTaskOk = Array.from({ length: n }, () => true);
  const perTaskUsageIn = Array.from({ length: n }, () => 0);
  const perTaskUsageOut = Array.from({ length: n }, () => 0);
  const perTaskCtxPct = Array.from({ length: n }, () => null as number | null);

  const resolveTaskAgentId = (item: ParallelTaskRow | undefined): string => {
    const dispatch = resolveDispatchAgentId(item?.agent_type ?? globalAgentType, catalog, subagentSettings);
    return dispatch.ok ? dispatch.id : resolveSubagentAgentId(item?.agent_type ?? globalAgentType, catalog);
  };

  const progressDetails = (taskIndex?: number) =>
    subagentDetails({
      ...parentBase,
      tool_calls: perTaskTools.reduce((s, x) => s + x, 0),
      ...(taskIndex === undefined ? {} : { task_index: taskIndex }),
      task_total: n,
      per_task_tool_calls: [...perTaskTools],
      per_task_started: [...perTaskStarted],
      per_task_done: [...perTaskDone],
      per_task_ok: [...perTaskOk],
      per_task_usage_input: [...perTaskUsageIn],
      per_task_usage_output: [...perTaskUsageOut],
      per_task_context_percent: [...perTaskCtxPct],
    });

  const flushBatch = () => {
    if (!onUpdate) return;
    tryParentToolUpdate(onUpdate, {
      content: [{ type: "text" as const, text: "" }],
      details: progressDetails(),
    });
  };

  const pushTaskProgress = (i: number) => {
    if (!onUpdate) return;
    tryParentToolUpdate(onUpdate, {
      content: [{ type: "text" as const, text: "" }],
      details: progressDetails(i),
    });
  };

  const prepareTask = (item: ParallelTaskRow) => {
    const at = resolveTaskAgentId(item);
    const file = catalog.agents.get(at)?.fileOptions ?? {};
    const defs = defaultsForAgentType(subagentSettings, at);
    const taskTimeout = resolveTimeoutMs(item.timeout_ms, subagentSettings.timeoutMs);
    const taskSignal = mergeAbortWithTimeoutMs(merged, taskTimeout);
    return { at, file, defs, taskSignal };
  };

  const pickThinking = (item: ParallelTaskRow, file: AgentPersonaFileOptions, defs: SubagentAgentTypeDefaults) =>
    item.thinking ?? globalThinking ?? file.thinking ?? defs.thinking;
  const pickInherit = (item: ParallelTaskRow, file: AgentPersonaFileOptions) =>
    item.inherit_context ?? globalInherit ?? file.inherit_context ?? false;
  const pickIsolated = (item: ParallelTaskRow, file: AgentPersonaFileOptions) =>
    item.isolated ?? globalIsolated ?? file.isolated ?? true;
  const pickMaxTurns = (item: ParallelTaskRow, file: AgentPersonaFileOptions) =>
    item.max_turns ?? globalMaxTurns ?? file.max_turns;

  const onTaskProgress = (p: SubagentChildProgress) => {
    const ti = p.task_index;
    if (typeof ti === "number" && ti >= 0 && ti < n) {
      perTaskStarted[ti] = true;
      perTaskTools[ti] = p.tool_calls;
      perTaskUsageIn[ti] = p.usage_input;
      perTaskUsageOut[ti] = p.usage_output;
      perTaskCtxPct[ti] = p.context_percent;
    }
  };

  const setupFailureResult = (e: unknown): RunSubAgentResult => ({
    text: "",
    isError: true,
    errorMessage: e instanceof Error ? e.message : String(e),
    tool_calls: 0,
    parent_session_id: parentBase.parent_session_id,
    parent_session_file: parentBase.parent_session_file,
    usage_input: 0,
    usage_output: 0,
    context_percent: null,
    context_tokens: null,
    context_window: 0,
  });

  const attemptTask = async (
    item: ParallelTaskRow,
    i: number,
    prep: ReturnType<typeof prepareTask>,
  ): Promise<RunSubAgentResult> => {
    try {
      return await runSubAgent(
        ctx,
        {
          task: item.task,
          model: item.model ?? globalModel,
          thinking: pickThinking(item, prep.file, prep.defs),
          inherit_context: pickInherit(item, prep.file),
          isolated: pickIsolated(item, prep.file),
          max_turns: pickMaxTurns(item, prep.file),
          agent_type: prep.at,
          stream: { task_index: i, task_total: n },
        },
        prep.taskSignal,
        onTaskProgress,
        catalog,
      );
    } catch (e) {
      // A setup throw means this task's agent never started; convert it to a
      // per-item error so one bad task cannot fail the whole batch.
      return setupFailureResult(e);
    }
  };

  const recordTaskResult = (i: number, r: RunSubAgentResult) => {
    perTaskTools[i] = r.tool_calls;
    perTaskUsageIn[i] = r.usage_input;
    perTaskUsageOut[i] = r.usage_output;
    perTaskCtxPct[i] = r.context_percent;
    perTaskDone[i] = true;
    perTaskOk[i] = !r.isError;
  };

  const ui = withThrottledParentFlush(onUpdate, flushBatch);
  ui.start();

  let results: RunSubAgentResult[];
  try {
    results = await mapConcurrent(tasks, limits.maxConcurrent, async (item, i) => {
      perTaskStarted[i] = true;
      const prep = prepareTask(item);
      const r = await attemptTask(item, i, prep);
      recordTaskResult(i, r);
      pushTaskProgress(i);
      return r;
    });
  } finally {
    ui.stopAndFlush();
  }

  const usageFieldsOf = (r: RunSubAgentResult) => ({
    usage_input: r.usage_input,
    usage_output: r.usage_output,
    usage_cache_read: r.usage_cache_read,
    usage_cache_write: r.usage_cache_write,
    usage_cost_usd: r.usage_cost_usd,
    context_percent: r.context_percent,
    context_tokens: r.context_tokens,
    context_window: r.context_window,
  });

  const batchItemFor = (r: RunSubAgentResult, i: number): SubagentBatchItemDetail => {
    const at = resolveTaskAgentId(tasks[i]);
    const desc = tasks[i]!.description.trim();
    const usageFields = usageFieldsOf(r);
    if (r.isError) {
      return {
        index: i,
        ok: false,
        error: r.errorMessage ?? "subagent failed",
        text: r.text.trim() || undefined,
        tool_calls: r.tool_calls,
        sub_session_file: r.sub_session_file,
        agent_type: at,
        description: desc,
        ...usageFields,
      };
    }
    return {
      index: i,
      ok: true,
      text: r.text,
      tool_calls: r.tool_calls,
      sub_session_file: r.sub_session_file,
      agent_type: at,
      description: desc,
      ...usageFields,
    };
  };

  const batchItems: SubagentBatchItemDetail[] = results.map((r, i) => batchItemFor(r, i));
  const totalToolCalls = batchItems.reduce((s, b) => s + b.tool_calls, 0);
  const usageInSum = batchItems.reduce((s, b) => s + (b.usage_input ?? 0), 0);
  const usageOutSum = batchItems.reduce((s, b) => s + (b.usage_output ?? 0), 0);
  const usageCacheReadSum = batchItems.reduce((s, b) => s + (b.usage_cache_read ?? 0), 0);
  const usageCacheWriteSum = batchItems.reduce((s, b) => s + (b.usage_cache_write ?? 0), 0);
  const usageCostSum = batchItems.reduce((s, b) => s + (b.usage_cost_usd ?? 0), 0);

  const batchAgentType = resolveTaskAgentId(undefined);

  const ownUsage = toPiUsage({
    usage_input: usageInSum,
    usage_output: usageOutSum,
    usage_cache_read: usageCacheReadSum,
    usage_cache_write: usageCacheWriteSum,
    usage_cost_usd: usageCostSum,
  });

  return {
    content: [
      {
        type: "text",
        text: formatBatchToolText(batchItems),
      },
    ],
    details: subagentDetails({
      ...parentBase,
      tool_calls: totalToolCalls,
      mode: "batch",
      batch: batchItems,
      agent_type: batchAgentType,
      ok: batchItems.every((b) => b.ok),
      usage_input: usageInSum,
      usage_output: usageOutSum,
      usage_cache_read: usageCacheReadSum,
      usage_cache_write: usageCacheWriteSum,
      usage_cost_usd: usageCostSum,
    }),
    ...(ownUsage ? { usage: ownUsage } : {}),
  };
}
