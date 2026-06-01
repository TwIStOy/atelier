import type {
  AgentToolResult,
  AgentToolUpdateCallback,
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  mapConcurrent,
  truncateDisplay,
  formatTokenUsageSummaryLine,
} from "@htwang-contrib/common";
import {
  createBackgroundJob,
  updateBackgroundJob,
  backgroundJobStatusPayload,
  subagentStatusToolDetails,
} from "./background-jobs.ts";
import { resolveSubagentAgentType } from "./agent-types.ts";
import { SUBAGENT_EVENTS } from "./events.ts";
import {
  runSubAgent,
  type SubagentBatchItemDetail,
  type SubagentRunDetails,
} from "./run-agent.ts";
import { readSubagentConcurrencyLimits } from "./settings.ts";

const SUBAGENT_TOOL_UI_TICK_MS = 100;

function subagentDetails(partial: SubagentRunDetails): SubagentRunDetails {
  return {
    tool_calls: partial.tool_calls,
    sub_session_file: partial.sub_session_file,
    parent_session_id: partial.parent_session_id ?? "unknown",
    parent_session_file: partial.parent_session_file ?? "",
    mode: partial.mode,
    task_index: partial.task_index,
    task_total: partial.task_total,
    per_task_tool_calls: partial.per_task_tool_calls,
    per_task_started: partial.per_task_started,
    per_task_done: partial.per_task_done,
    per_task_ok: partial.per_task_ok,
    per_task_usage_input: partial.per_task_usage_input,
    per_task_usage_output: partial.per_task_usage_output,
    per_task_context_percent: partial.per_task_context_percent,
    batch: partial.batch,
    agent_type: partial.agent_type,
    description: partial.description,
    ok: partial.ok,
    error: partial.error,
    background: partial.background,
    background_id: partial.background_id,
    usage_input: partial.usage_input,
    usage_output: partial.usage_output,
    context_percent: partial.context_percent,
    context_tokens: partial.context_tokens,
    context_window: partial.context_window,
  };
}

function tryParentToolUpdate(
  onUpdate: AgentToolUpdateCallback<SubagentRunDetails> | undefined,
  payload: AgentToolResult<SubagentRunDetails>,
) {
  if (!onUpdate) return;
  try {
    const r = onUpdate(payload);
    if (r != null && typeof (r as Promise<void>).then === "function") {
      void (r as Promise<void>).catch(() => {});
    }
  } catch {}
}

function formatBatchToolText(items: SubagentBatchItemDetail[]): string {
  const ok = items.filter((x) => x.ok).length;
  const err = items.length - ok;
  const out: string[] = [
    `Subagent batch: ${items.length} task(s); ${ok} ok, ${err} error(s).`,
    "",
  ];
  for (const it of items) {
    out.push(`### Task ${it.index} — ${it.ok ? "ok" : "error"}`);
    if (it.ok) {
      const t = (it.text ?? "").trim() || "(empty reply)";
      out.push(t.length > 12_000 ? `${t.slice(0, 12_000)}\n…` : t);
    } else {
      out.push(it.error ?? "unknown error");
    }
    if (
      (typeof it.usage_input === "number" && it.usage_input > 0) ||
      (typeof it.usage_output === "number" && it.usage_output > 0) ||
      it.context_percent != null
    ) {
      const up = typeof it.usage_input === "number" ? it.usage_input : 0;
      const down = typeof it.usage_output === "number" ? it.usage_output : 0;
      out.push(formatTokenUsageSummaryLine(up, down, it.context_percent));
    }
    out.push("");
  }
  return out.join("\n");
}

function validateTaskShape(params: {
  task?: string;
  description?: string;
  tasks?: { task: string; description: string }[];
}):
  | { ok: true; mode: "single" }
  | { ok: true; mode: "batch" }
  | { ok: false; message: string } {
  const hasTask = Boolean(params.task?.trim());
  const hasTasks = Boolean(params.tasks && params.tasks.length > 0);
  if (hasTask && hasTasks) {
    return {
      ok: false,
      message: "subagent: pass either `task` or `tasks`, not both.",
    };
  }
  if (!hasTask && !hasTasks) {
    return {
      ok: false,
      message:
        "subagent: provide `task` (single) or a non-empty `tasks` array (parallel batch).",
    };
  }
  if (hasTasks && params.tasks) {
    for (let i = 0; i < params.tasks.length; i++) {
      if (!params.tasks[i].task?.trim()) {
        return {
          ok: false,
          message: `subagent: tasks[${i}].task is empty.`,
        };
      }
      if (!params.tasks[i].description?.trim()) {
        return {
          ok: false,
          message: `subagent: tasks[${i}].description is required (short tree label).`,
        };
      }
    }
    return { ok: true, mode: "batch" };
  }
  if (!params.description?.trim()) {
    return {
      ok: false,
      message:
        "subagent: `description` is required in single-task mode (short label for the tool tree).",
    };
  }
  return { ok: true, mode: "single" };
}

type ParallelTaskRow = {
  task: string;
  description: string;
  model?: string;
  thinking?: string;
  inherit_context?: boolean;
  isolated?: boolean;
  max_turns?: number;
  agent_type?: "default" | "research" | "review" | "plan";
};

async function runParallelBatchSubagent(
  ctx: ExtensionContext,
  args: {
    tasks: ParallelTaskRow[];
    parentBase: {
      parent_session_id: string;
      parent_session_file: string;
    };
    merged: AbortSignal | undefined;
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

  let flushTimer: ReturnType<typeof setInterval> | undefined;
  if (onUpdate) {
    flushTimer = setInterval(flushBatch, SUBAGENT_TOOL_UI_TICK_MS);
    (flushTimer as NodeJS.Timeout & { unref?: () => void }).unref?.();
    flushBatch();
  }

  let results: Awaited<ReturnType<typeof runSubAgent>>[];
  try {
    results = await mapConcurrent(
      tasks,
      limits.maxConcurrent,
      async (item, i) => {
        perTaskStarted[i] = true;
        const r = await runSubAgent(
          ctx,
          {
            task: item.task,
            model: item.model ?? globalModel,
            thinking: item.thinking ?? globalThinking,
            inherit_context: item.inherit_context ?? globalInherit,
            isolated: item.isolated ?? globalIsolated,
            max_turns: item.max_turns ?? globalMaxTurns,
            agent_type: item.agent_type ?? globalAgentType,
            stream: { task_index: i, task_total: n },
          },
          merged,
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
    if (flushTimer !== undefined) {
      clearInterval(flushTimer);
    }
    if (onUpdate) flushBatch();
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

async function runSingleSubagent(
  ctx: ExtensionContext,
  args: {
    task: string;
    description: string;
    parentBase: {
      parent_session_id: string;
      parent_session_file: string;
    };
    merged: AbortSignal | undefined;
    onUpdate?: AgentToolUpdateCallback<SubagentRunDetails>;
    globalModel?: string;
    globalThinking?: string;
    globalInherit: boolean;
    globalIsolated: boolean;
    globalMaxTurns?: number;
    globalAgentType?: "default" | "research" | "review" | "plan";
  },
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  details: SubagentRunDetails;
}> {
  const {
    task,
    description,
    parentBase,
    merged,
    onUpdate,
    globalModel,
    globalThinking,
    globalInherit,
    globalIsolated,
    globalMaxTurns,
    globalAgentType,
  } = args;
  const singleAgentType = resolveSubagentAgentType(globalAgentType);
  let prog = {
    tool_calls: 0,
    sub_session_file: undefined as string | undefined,
    usage_input: 0,
    usage_output: 0,
    context_percent: null as number | null,
    context_tokens: null as number | null,
    context_window: 0,
  };
  const flushSingle = () => {
    if (!onUpdate) return;
    tryParentToolUpdate(onUpdate, {
      content: [
        {
          type: "text" as const,
          text: `${prog.tool_calls} tool uses…`,
        },
      ],
      details: subagentDetails({
        ...parentBase,
        tool_calls: prog.tool_calls,
        sub_session_file: prog.sub_session_file,
        mode: "single",
        agent_type: singleAgentType,
        description,
        usage_input: prog.usage_input,
        usage_output: prog.usage_output,
        context_percent: prog.context_percent,
        context_tokens: prog.context_tokens,
        context_window: prog.context_window,
      }),
    });
  };
  let flushTimer: ReturnType<typeof setInterval> | undefined;
  if (onUpdate) {
    flushTimer = setInterval(flushSingle, SUBAGENT_TOOL_UI_TICK_MS);
    (flushTimer as NodeJS.Timeout & { unref?: () => void }).unref?.();
    flushSingle();
  }
  let result: Awaited<ReturnType<typeof runSubAgent>>;
  try {
    result = await runSubAgent(
      ctx,
      {
        task,
        model: globalModel,
        thinking: globalThinking,
        inherit_context: globalInherit,
        isolated: globalIsolated,
        max_turns: globalMaxTurns,
        agent_type: globalAgentType,
      },
      merged,
      (p) => {
        prog = {
          tool_calls: p.tool_calls,
          sub_session_file: p.sub_session_file ?? prog.sub_session_file,
          usage_input: p.usage_input,
          usage_output: p.usage_output,
          context_percent: p.context_percent,
          context_tokens: p.context_tokens,
          context_window: p.context_window,
        };
      },
    );
  } finally {
    if (flushTimer !== undefined) {
      clearInterval(flushTimer);
    }
    if (onUpdate) flushSingle();
  }
  if (result.isError) {
    return {
      content: [
        {
          type: "text",
          text: result.errorMessage ?? "subagent failed",
        },
      ],
      details: subagentDetails({
        tool_calls: result.tool_calls,
        sub_session_file: result.sub_session_file,
        parent_session_id: result.parent_session_id,
        parent_session_file: result.parent_session_file,
        mode: "single",
        agent_type: singleAgentType,
        description,
        ok: false,
        error: result.errorMessage ?? "subagent failed",
        usage_input: result.usage_input,
        usage_output: result.usage_output,
        context_percent: result.context_percent,
        context_tokens: result.context_tokens,
        context_window: result.context_window,
      }),
    };
  }
  return {
    content: [
      {
        type: "text",
        text: result.text.length > 0 ? result.text : "(empty subagent reply)",
      },
    ],
    details: subagentDetails({
      tool_calls: result.tool_calls,
      sub_session_file: result.sub_session_file,
      parent_session_id: result.parent_session_id,
      parent_session_file: result.parent_session_file,
      mode: "single",
      agent_type: singleAgentType,
      description,
      ok: true,
      usage_input: result.usage_input,
      usage_output: result.usage_output,
      context_percent: result.context_percent,
      context_tokens: result.context_tokens,
      context_window: result.context_window,
    }),
  };
}

function finalizeBackgroundSuccess(
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
  const text =
    r.content[0]?.type === "text" && typeof r.content[0].text === "string"
      ? r.content[0].text
      : "";
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

function finalizeBackgroundThrown(
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
  ctx.ui.notify(
    `Subagent crashed (${truncateDisplay(label, 48)}): ${truncateDisplay(msg, 160)}`,
    "error",
  );
}

function backgroundStartedReply(
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

const subagentAgentTypeSchema = Type.Union(
  [
    Type.Literal("default"),
    Type.Literal("research"),
    Type.Literal("review"),
    Type.Literal("plan"),
  ],
  {
    description:
      "Which system prompt persona to inject: default (balanced worker), research (evidence-first), review (critique), plan (steps and tradeoffs, not full implementation).",
  },
);

const taskItem = Type.Object({
  task: Type.String({
    description:
      "Instructions for this sub-agent; optional fields below override batch-level defaults.",
  }),
  description: Type.String({
    minLength: 1,
    maxLength: 72,
    description:
      "Required short label for the collapsed tool tree (after agent type, before tool counts).",
  }),
  model: Type.Optional(
    Type.String({
      description:
        "Optional per-task model hint; falls back to batch `model` then parent model.",
    }),
  ),
  thinking: Type.Optional(
    Type.String({
      description:
        "Optional per-task thinking level; falls back to batch `thinking`.",
    }),
  ),
  inherit_context: Type.Optional(
    Type.Boolean({
      description:
        "When true, prepends truncated parent system prompt; falls back to batch `inherit_context`.",
      default: false,
    }),
  ),
  isolated: Type.Optional(
    Type.Boolean({
      description:
        "Per-task isolated flag; falls back to batch `isolated` (default true).",
    }),
  ),
  max_turns: Type.Optional(
    Type.Number({
      description: "Per-task turn cap; falls back to batch `max_turns`.",
      minimum: 1,
    }),
  ),
  agent_type: Type.Optional(subagentAgentTypeSchema),
});

const subagentParams = Type.Object({
  task: Type.Optional(
    Type.String({
      description:
        "Single-task mode: one assignment (mutually exclusive with non-empty `tasks`).",
    }),
  ),
  description: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 72,
      description:
        "Required with `task` (single mode): short label for the collapsed tool tree (after agent type, before tool counts). Omit when using `tasks`.",
    }),
  ),
  tasks: Type.Optional(
    Type.Array(taskItem, {
      minItems: 1,
      maxItems: 32,
      description:
        "Parallel batch: multiple assignments run with a concurrency limit (mutually exclusive with non-empty `task`). Partial failures are all reported in the tool result text and `details.batch`.",
    }),
  ),
  background: Type.Optional(
    Type.Boolean({
      default: false,
      description:
        "When true, starts the run asynchronously and returns immediately with { id } in the reply; use `subagent_status` to read results. Cancellation follows the parent session signal only.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description:
        "Optional model hint: exact provider/modelId, model id, fuzzy name, etc. Resolved via @htwang-contrib/common resolveModel against getAvailable(); falls back to parent model. In batch mode, applies to any task without its own `model`.",
    }),
  ),
  thinking: Type.Optional(
    Type.String({
      description:
        "Optional thinking level: off, minimal, low, medium, high, xhigh. Invalid values are ignored.",
    }),
  ),
  inherit_context: Type.Optional(
    Type.Boolean({
      description:
        "When true, prepends a truncated copy of the parent system prompt before each task (unless overridden per task).",
      default: false,
    }),
  ),
  isolated: Type.Optional(
    Type.Boolean({
      description:
        "When true (default), each sub-agent loads no extensions and only read/search tools (read, grep, find, ls). When false, bash/edit/write are enabled; extensions stay disabled to avoid nested subagent registration.",
      default: true,
    }),
  ),
  max_turns: Type.Optional(
    Type.Number({
      description:
        "Optional cap on agentic turns per sub-agent; after this count the sub-agent is steered to finish, then hard-aborted if it continues.",
      minimum: 1,
    }),
  ),
  max_concurrent: Type.Optional(
    Type.Number({
      description:
        "Parallel batch only: overrides ~/.agent/subagents/settings.json `max_concurrent` for this call (minimum 1).",
      minimum: 1,
    }),
  ),
  max_total: Type.Optional(
    Type.Number({
      description:
        "Parallel batch only: overrides settings `max_total` (maximum number of tasks accepted in `tasks`) for this call (minimum 1).",
      minimum: 1,
    }),
  ),
  agent_type: Type.Optional(subagentAgentTypeSchema),
});

export function registerSubagentStatusTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent_status",
    label: "Subagent status",
    description:
      "Returns JSON status for a background subagent job: pass `id` from a `subagent` call with `background: true`. States: running, done (includes partial batch failures via ok and batch_counts), error (unhandled exception), unknown (expired id).",
    parameters: Type.Object({
      id: Type.String({
        description: "Job id printed in the background `subagent` tool result.",
      }),
    }),
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
      "Runs one or more in-process Pi AgentSession values (no extra pi OS process). Single mode: non-empty `task` plus required `description` (short tree label). Parallel mode: `tasks` array, each item with required `description`; runs up to `max_concurrent` at a time (defaults from ~/.agent/subagents/settings.json, typically 4 concurrent / 8 total). Optional `background: true` returns immediately with an `id`; poll with `subagent_status`. On completion, emits `subagent:complete` on `pi.events` and shows `ctx.ui.notify`. Optional `agent_type` selects the injected system prompt (default, research, review, plan). When some tasks fail, the tool still returns 200-style success with a per-task summary: failed tasks appear under `### Task N — error` and `details.batch[].ok === false`. Sessions persist under ~/.agent/subagents/session; linkage lines append under ~/.agent/subagents/by-parent/<parent_id>.jsonl. Default tools are read-only unless `isolated=false`.",
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
      const runSignal = isBackground ? bgSignal : merged;

      const globalModel = params.model;
      const globalThinking = params.thinking;
      const globalInherit = params.inherit_context === true;
      const globalIsolated = params.isolated !== false;
      const globalMaxTurns = params.max_turns;
      const globalAgentType = params.agent_type;

      if (shape.mode === "batch" && params.tasks) {
        const limits = readSubagentConcurrencyLimits({
          max_concurrent: params.max_concurrent,
          max_total: params.max_total,
        });
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
            merged: runSignal,
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
          merged: runSignal,
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
