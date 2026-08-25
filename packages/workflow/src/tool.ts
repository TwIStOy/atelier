import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { WORKFLOW_PROMPT_GUIDELINES, WORKFLOW_PROMPT_SNIPPET, WORKFLOW_TOOL_DESCRIPTION } from "./prompt.ts";
import { executeWorkflowRun } from "./run-executor.ts";

const workflowParams = Type.Object({
  script: Type.Optional(
    Type.String({
      description:
        'JavaScript workflow script (not TypeScript). The first statement must be exactly `export const meta = { name: "...", description: "..." }` with literal strings. Use agent()/parallel()/pipeline()/phase(); the top-level return value becomes the workflow result. Required unless resume_run_id is given.',
    }),
  ),
  args: Type.Optional(
    Type.Unknown({
      description:
        "Optional structured JSON value exposed to the script as the `args` global. Pass objects and arrays directly, not as JSON-encoded strings.",
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
    description: WORKFLOW_TOOL_DESCRIPTION,
    promptSnippet: WORKFLOW_PROMPT_SNIPPET,
    promptGuidelines: WORKFLOW_PROMPT_GUIDELINES,
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
