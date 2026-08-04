import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { runChildAgent } from "@htwang-contrib/common";
import extraTools from "@htwang-contrib/extra-tools";
import inferenceSelfHost from "@htwang-contrib/inference-self-host";
import inferenceV2SelfHost from "@htwang-contrib/inference-v2-self-host";
import protectSecrets from "@htwang-contrib/protect-secrets";
import webTools from "@htwang-contrib/web-tools";
import { Type } from "typebox";
import { loadWorkflowConfig } from "./config.ts";
import { createStreamingWorkflowDisplay, createWidgetWorkflowDisplay, type WorkflowDisplay } from "./display.ts";
import { runWorkflow, type WorkflowAgentRunner } from "./engine.ts";
import { WORKFLOW_SESSION_DIR } from "./paths.ts";

const WORKFLOW_CHILD_FACTORIES: ExtensionFactory[] = [
  protectSecrets,
  extraTools,
  webTools,
  inferenceSelfHost,
  inferenceV2SelfHost,
];

const workflowParams = Type.Object({
  script: Type.String({
    description:
      "JavaScript workflow script. First statement must be `export const meta = { name, description }`. Use agent()/parallel()/pipeline()/phase() to orchestrate sub-agents; the top-level return value becomes the workflow result.",
  }),
  args: Type.Optional(
    Type.Unknown({
      description: "Optional JSON value exposed to the script as the `args` global.",
    }),
  ),
});

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "undefined";
  } catch {
    return String(value);
  }
}

function buildRunner(ctx: ExtensionContext): WorkflowAgentRunner {
  return async (call, { signal, onProgress }) => {
    const result = await runChildAgent(
      ctx,
      {
        task: call.task,
        model: call.model,
        thinking: call.thinking,
        inherit_context: call.inherit_context,
        isolated: call.isolated,
        max_turns: call.max_turns,
        agent_type: call.agent_type,
        extensionFactories: WORKFLOW_CHILD_FACTORIES,
        sessionDir: WORKFLOW_SESSION_DIR,
        outputSchema: call.schema ? Type.Unsafe(call.schema) : undefined,
        onProgress: (p) => onProgress(p.tool_calls),
      },
      signal,
    );
    return {
      ok: !result.isError,
      value: result.value,
      text: result.text,
      error: result.errorMessage,
    };
  };
}

export function registerWorkflowTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "workflow",
    label: "Workflow",
    description:
      "Run a dynamic workflow: execute a generated JavaScript script that fans work out to multiple isolated sub-agents via agent()/parallel()/pipeline() and aggregates their results. Use for codebase audits, multi-perspective reviews, batch refactors, and fan-out research.",
    promptSnippet:
      "Orchestrate multiple sub-agents with a generated JavaScript workflow script (agent/parallel/pipeline).",
    promptGuidelines: [
      "Prefer `workflow` over sequential `subagent` calls when the orchestration shape is known up front: one tool call schedules all sub-agents with concurrency control and live progress.",
      'The first statement must be exactly `export const meta = { name: "...", description: "..." }` with literal values only (no spread, computed keys, methods, or __proto__).',
      "Available globals: `agent(call)`, `parallel(fns)`, `pipeline(value, ...stages)`, `phase(title)`, `args`, `console`. Imports, `require`, `process`, `globalThis`, `eval`, and `Function` are rejected.",
      '`agent({ label, task, agent_type?, model?, thinking?, inherit_context?, isolated?, max_turns?, schema? })` runs one isolated child agent. It resolves to the agent\'s final text, or to a parsed value when `schema` (a JSON Schema with type "object") is given. It resolves to null on failure — always null-check before using a result.',
      "`agent_type` selects a persona from the <subagents> catalog (for example explore, plan, scout) when that catalog is available; omit it for a general-purpose agent. Unknown ids fall back to general-purpose.",
      "`parallel` takes an array of zero-argument functions: `parallel([() => agent({...}), () => agent({...})])`. Passing promises instead of functions is an error.",
      "`pipeline(initial, (prev) => agent({...}), ...)` threads each stage's result into the next.",
      'Call `phase("title")` before the agents it should group in the progress UI; skipped branches never render as empty phases.',
      "End the script with a final synthesis agent that receives the collected results, and `return` its value (or a plain-object summary) from the top level.",
      "Keep agent counts small (default caps: 4 concurrent, 32 total per workflow); use loops and conditionals freely — the runtime enforces the caps.",
    ],
    parameters: workflowParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (!ctx.model) {
        return {
          content: [{ type: "text", text: "workflow: parent session has no active model; select a model first." }],
          details: { ok: false, error: "no active model" },
        };
      }

      const config = loadWorkflowConfig();
      const display: WorkflowDisplay = ctx.hasUI
        ? createWidgetWorkflowDisplay(ctx.ui)
        : createStreamingWorkflowDisplay(onUpdate);
      const merged = signal ? (ctx.signal ? AbortSignal.any([signal, ctx.signal]) : signal) : ctx.signal;

      const result = await runWorkflow(params.script, {
        args: params.args,
        signal: merged,
        runAgent: buildRunner(ctx),
        maxConcurrency: config.maxConcurrency,
        maxAgents: config.maxAgents,
        onSnapshot: (snapshot) => display.update(snapshot),
      });
      display.finish(result.snapshot);

      const summary = {
        ok: result.ok,
        error: result.error,
        value: result.value,
        agents: result.snapshot.agents.map((a) => ({
          label: a.label,
          status: a.status,
          toolCalls: a.toolCalls,
          detail: a.detail,
        })),
      };
      const trunc = truncateHead(safeStringify(summary), {
        maxLines: DEFAULT_MAX_LINES,
        maxBytes: DEFAULT_MAX_BYTES,
      });
      let text = trunc.content;
      if (trunc.truncated) {
        text += `\n\n[Output truncated: ${trunc.outputLines} of ${trunc.totalLines} lines (${formatSize(trunc.outputBytes)} of ${formatSize(trunc.totalBytes)}).]`;
      }
      if (!result.ok) {
        text += "\n\nFix the script or failing agents and call the workflow tool again.";
      }

      return {
        content: [{ type: "text", text }],
        details: {
          ok: result.ok,
          error: result.error,
          workflow: result.snapshot,
        },
      };
    },
  });
}
