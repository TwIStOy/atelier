import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { executeWorkflowRun } from "./run-executor.ts";

const workflowParams = Type.Object({
  script: Type.Optional(
    Type.String({
      description:
        "JavaScript workflow script. First statement must be `export const meta = { name, description }`. Use agent()/parallel()/pipeline()/phase() to orchestrate sub-agents; the top-level return value becomes the workflow result. Required unless resume_run_id is given.",
    }),
  ),
  args: Type.Optional(
    Type.Unknown({
      description: "Optional JSON value exposed to the script as the `args` global.",
    }),
  ),
  resume_run_id: Type.Optional(
    Type.String({
      description:
        "Resume a paused or failed run by its run_id (from a previous result). The stored script and args are reused; agents that completed before the cutoff replay from cache.",
    }),
  ),
  save_as: Type.Optional(
    Type.String({
      description:
        "After a successful run, save this script as a reusable slash command with this name (normalized). Only applies when the run succeeds.",
    }),
  ),
  save_scope: Type.Optional(
    Type.Union([Type.Literal("user"), Type.Literal("project")], {
      description:
        "Where save_as persists: 'user' (~/.config/pi/workflows, every project) or 'project' (.pi/workflows, shared via the repo). Default 'user'.",
    }),
  ),
});

export function registerWorkflowTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "workflow",
    label: "Workflow",
    description:
      "Run a dynamic workflow: execute a generated JavaScript script that fans work out to multiple isolated sub-agents via agent()/parallel()/pipeline() and aggregates their results. Use for codebase audits, multi-perspective reviews, batch refactors, and fan-out research. Supports pausing (Esc) and resuming via resume_run_id, and saving a successful script as a reusable slash command via save_as.",
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
      "Every result carries a `run_id`. If a run was aborted or failed, resume it with `resume_run_id` (omit `script`) — agents that completed before the interruption replay from cache in start order; everything after the first unfinished agent re-runs.",
      "When the user asks to keep a workflow for reuse, re-run it with `save_as` (or set save_as on the first run) so the script becomes a slash command. Saved commands take effect after /reload and accept JSON arguments via the `args` global.",
    ],
    parameters: workflowParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const result = await executeWorkflowRun(ctx, {
        script: params.script,
        args: params.args,
        resumeRunId: params.resume_run_id,
        saveAs: params.save_as,
        saveScope: params.save_scope,
        signal,
        onUpdate,
      });
      return {
        content: [{ type: "text", text: result.text }],
        details: result.details,
      };
    },
  });
}
