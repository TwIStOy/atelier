import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mapConcurrent } from "./concurrency.ts";
import { resolveSubagentAgentType } from "./agent-types.ts";
import {
  runSubAgent,
  type SubagentBatchItemDetail,
  type SubagentRunDetails,
} from "./run-agent.ts";
import { readSubagentConcurrencyLimits } from "./settings.ts";

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
    batch: partial.batch,
    agent_type: partial.agent_type,
    description: partial.description,
    ok: partial.ok,
    error: partial.error,
  };
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

export function registerSubagentTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "subagent",
    label: "Subagent",
    description:
      "Runs one or more in-process Pi AgentSession values (no extra pi OS process). Single mode: non-empty `task` plus required `description` (short tree label). Parallel mode: `tasks` array, each item with required `description`; runs up to `max_concurrent` at a time (defaults from ~/.agent/subagents/settings.json, typically 4 concurrent / 8 total). Optional `agent_type` selects the injected system prompt (default, research, review, plan). When some tasks fail, the tool still returns 200-style success with a per-task summary: failed tasks appear under `### Task N — error` and `details.batch[].ok === false`. Sessions persist under ~/.agent/subagents/session; linkage lines append under ~/.agent/subagents/by-parent/<parent_id>.jsonl. Default tools are read-only unless `isolated=false`.",
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
        const tasks = params.tasks;
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

        const n = tasks.length;
        const perTaskTools = Array.from({ length: n }, () => 0);
        const perTaskStarted = Array.from({ length: n }, () => false);
        const perTaskDone = Array.from({ length: n }, () => false);
        const perTaskOk = Array.from({ length: n }, () => true);
        const parallelOnUpdate = onUpdate
          ? (update: Parameters<NonNullable<typeof onUpdate>>[0]) => {
              const det = update.details as SubagentRunDetails | undefined;
              if (
                det &&
                typeof det.task_index === "number" &&
                det.task_index >= 0 &&
                det.task_index < n
              ) {
                perTaskStarted[det.task_index] = true;
                if (typeof det.tool_calls === "number") {
                  perTaskTools[det.task_index] = det.tool_calls;
                }
              }
              const total = perTaskTools.reduce((s, x) => s + x, 0);
              onUpdate({
                ...update,
                details: subagentDetails({
                  ...parentBase,
                  tool_calls: total,
                  task_index: det?.task_index,
                  task_total: n,
                  per_task_tool_calls: [...perTaskTools],
                  per_task_started: [...perTaskStarted],
                  per_task_done: [...perTaskDone],
                  per_task_ok: [...perTaskOk],
                }),
              });
            }
          : undefined;
        const results = await mapConcurrent(
          tasks,
          limits.maxConcurrent,
          async (item, i) => {
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
              parallelOnUpdate,
            );
            perTaskDone[i] = true;
            perTaskOk[i] = !r.isError;
            if (onUpdate) {
              onUpdate({
                content: [{ type: "text", text: "" }],
                details: subagentDetails({
                  ...parentBase,
                  tool_calls: perTaskTools.reduce((s, x) => s + x, 0),
                  task_index: i,
                  task_total: n,
                  per_task_tool_calls: [...perTaskTools],
                  per_task_started: [...perTaskStarted],
                  per_task_done: [...perTaskDone],
                  per_task_ok: [...perTaskOk],
                }),
              });
            }
            return r;
          },
        );

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
              }
            : {
                index: i,
                ok: true,
                text: r.text,
                tool_calls: r.tool_calls,
                sub_session_file: r.sub_session_file,
                agent_type: at,
                description: desc,
              };
        });
        const totalToolCalls = batchItems.reduce((s, b) => s + b.tool_calls, 0);

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
          }),
        };
      }

      const isolated = globalIsolated;
      const singleAgentType = resolveSubagentAgentType(globalAgentType);
      const singleDescription = params.description!.trim();
      const singleOnUpdate = onUpdate
        ? (update: Parameters<NonNullable<typeof onUpdate>>[0]) => {
            const det = update.details as SubagentRunDetails | undefined;
            if (!det) {
              onUpdate(update);
              return;
            }
            onUpdate({
              ...update,
              details: subagentDetails({
                ...det,
                description: singleDescription,
              }),
            });
          }
        : undefined;
      const result = await runSubAgent(
        ctx,
        {
          task: params.task!.trim(),
          model: globalModel,
          thinking: globalThinking,
          inherit_context: globalInherit,
          isolated,
          max_turns: globalMaxTurns,
          agent_type: globalAgentType,
        },
        merged,
        singleOnUpdate,
      );
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
            description: singleDescription,
            ok: false,
            error: result.errorMessage ?? "subagent failed",
          }),
        };
      }
      return {
        content: [
          {
            type: "text",
            text:
              result.text.length > 0 ? result.text : "(empty subagent reply)",
          },
        ],
        details: subagentDetails({
          tool_calls: result.tool_calls,
          sub_session_file: result.sub_session_file,
          parent_session_id: result.parent_session_id,
          parent_session_file: result.parent_session_file,
          mode: "single",
          agent_type: singleAgentType,
          description: singleDescription,
          ok: true,
        }),
      };
    },
  });
}
