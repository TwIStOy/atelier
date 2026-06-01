import type {
  AgentToolUpdateCallback,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { mapConcurrent } from "@htwang-contrib/common";
import { mergeAbortWithTimeoutMs } from "./abort-timeout.ts";
import { resolveSubagentAgentType } from "./agent-types.ts";
import { formatBatchToolText } from "./batch-text.ts";
import { subagentDetails } from "./details.ts";
import {
  tryParentToolUpdate,
  withThrottledParentFlush,
} from "./parent-update.ts";
import {
  defaultsForAgentType,
  resolveTimeoutMs,
  type SubagentSettings,
} from "./settings.ts";
import {
  runSubAgent,
  type SubagentBatchItemDetail,
  type SubagentRunDetails,
} from "./run-agent.ts";

export type ParallelTaskRow = {
  task: string;
  description: string;
  model?: string;
  thinking?: string;
  inherit_context?: boolean;
  isolated?: boolean;
  max_turns?: number;
  timeout_ms?: number;
  agent_type?: "default" | "research" | "review" | "plan";
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
    globalInherit: boolean;
    globalIsolated: boolean;
    globalMaxTurns?: number;
    globalAgentType?: "default" | "research" | "review" | "plan";
    limits: { maxConcurrent: number; maxTotal: number };
  },
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  details: SubagentRunDetails;
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
  const n = tasks.length;
  const perTaskTools = Array.from({ length: n }, () => 0);
  const perTaskStarted = Array.from({ length: n }, () => false);
  const perTaskDone = Array.from({ length: n }, () => false);
  const perTaskOk = Array.from({ length: n }, () => true);
  const perTaskUsageIn = Array.from({ length: n }, () => 0);
  const perTaskUsageOut = Array.from({ length: n }, () => 0);
  const perTaskCtxPct = Array.from({ length: n }, () => null as number | null);

  const flushBatch = () => {
    if (!onUpdate) return;
    tryParentToolUpdate(onUpdate, {
      content: [{ type: "text" as const, text: "" }],
      details: subagentDetails({
        ...parentBase,
        tool_calls: perTaskTools.reduce((s, x) => s + x, 0),
        task_total: n,
        per_task_tool_calls: [...perTaskTools],
        per_task_started: [...perTaskStarted],
        per_task_done: [...perTaskDone],
        per_task_ok: [...perTaskOk],
        per_task_usage_input: [...perTaskUsageIn],
        per_task_usage_output: [...perTaskUsageOut],
        per_task_context_percent: [...perTaskCtxPct],
      }),
    });
  };

  const ui = withThrottledParentFlush(onUpdate, flushBatch);
  ui.start();

  let results: Awaited<ReturnType<typeof runSubAgent>>[];
  try {
    results = await mapConcurrent(
      tasks,
      limits.maxConcurrent,
      async (item, i) => {
        perTaskStarted[i] = true;
        const at = resolveSubagentAgentType(item.agent_type ?? globalAgentType);
        const defs = defaultsForAgentType(subagentSettings, at);
        const taskTimeout = resolveTimeoutMs(
          item.timeout_ms,
          subagentSettings.timeoutMs,
        );
        const taskSignal = mergeAbortWithTimeoutMs(merged, taskTimeout);
        const r = await runSubAgent(
          ctx,
          {
            task: item.task,
            model: item.model ?? globalModel ?? defs.model,
            thinking: item.thinking ?? globalThinking ?? defs.thinking,
            inherit_context: item.inherit_context ?? globalInherit,
            isolated: item.isolated ?? globalIsolated,
            max_turns: item.max_turns ?? globalMaxTurns,
            agent_type: item.agent_type ?? globalAgentType,
            stream: { task_index: i, task_total: n },
          },
          taskSignal,
          (p) => {
            const ti = p.task_index;
            if (typeof ti === "number" && ti >= 0 && ti < n) {
              perTaskStarted[ti] = true;
              perTaskTools[ti] = p.tool_calls;
              perTaskUsageIn[ti] = p.usage_input;
              perTaskUsageOut[ti] = p.usage_output;
              perTaskCtxPct[ti] = p.context_percent;
            }
          },
        );
        perTaskTools[i] = r.tool_calls;
        perTaskUsageIn[i] = r.usage_input;
        perTaskUsageOut[i] = r.usage_output;
        perTaskCtxPct[i] = r.context_percent;
        perTaskDone[i] = true;
        perTaskOk[i] = !r.isError;
        if (onUpdate) {
          tryParentToolUpdate(onUpdate, {
            content: [{ type: "text" as const, text: "" }],
            details: subagentDetails({
              ...parentBase,
              tool_calls: perTaskTools.reduce((s, x) => s + x, 0),
              task_index: i,
              task_total: n,
              per_task_tool_calls: [...perTaskTools],
              per_task_started: [...perTaskStarted],
              per_task_done: [...perTaskDone],
              per_task_ok: [...perTaskOk],
              per_task_usage_input: [...perTaskUsageIn],
              per_task_usage_output: [...perTaskUsageOut],
              per_task_context_percent: [...perTaskCtxPct],
            }),
          });
        }
        return r;
      },
    );
  } finally {
    ui.stopAndFlush();
  }

  const batchItems: SubagentBatchItemDetail[] = results.map((r, i) => {
    const at = resolveSubagentAgentType(
      tasks[i]?.agent_type ?? globalAgentType,
    );
    const desc = tasks[i]!.description.trim();
    return r.isError
      ? {
          index: i,
          ok: false,
          error: r.errorMessage ?? "subagent failed",
          tool_calls: r.tool_calls,
          sub_session_file: r.sub_session_file,
          agent_type: at,
          description: desc,
          usage_input: r.usage_input,
          usage_output: r.usage_output,
          context_percent: r.context_percent,
          context_tokens: r.context_tokens,
          context_window: r.context_window,
        }
      : {
          index: i,
          ok: true,
          text: r.text,
          tool_calls: r.tool_calls,
          sub_session_file: r.sub_session_file,
          agent_type: at,
          description: desc,
          usage_input: r.usage_input,
          usage_output: r.usage_output,
          context_percent: r.context_percent,
          context_tokens: r.context_tokens,
          context_window: r.context_window,
        };
  });
  const totalToolCalls = batchItems.reduce((s, b) => s + b.tool_calls, 0);
  const usageInSum = batchItems.reduce((s, b) => s + (b.usage_input ?? 0), 0);
  const usageOutSum = batchItems.reduce((s, b) => s + (b.usage_output ?? 0), 0);

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
      agent_type: resolveSubagentAgentType(globalAgentType),
      ok: batchItems.every((b) => b.ok),
      usage_input: usageInSum,
      usage_output: usageOutSum,
    }),
  };
}
