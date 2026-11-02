export const WORKFLOW_TOOL_DESCRIPTION =
  "Run or resume a dynamic multi-agent workflow. Use only when the user explicitly requests workflow orchestration or invokes a skill or saved workflow that requires it.";

export const WORKFLOW_PROMPT_SNIPPET =
  "Run or resume an explicitly opted-in multi-agent workflow with generated JavaScript orchestration";

export const WORKFLOW_PROMPT_GUIDELINES = [
  "Invoke `workflow` only when the user explicitly requests workflow or multi-agent orchestration, asks to resume a workflow, or invokes a skill or saved workflow that requires it. Do not invoke `workflow` solely because parallelism might help.",
  "After workflow orchestration is opted into, prefer one `workflow` call over sequential `subagent` calls when the orchestration shape is known up front. If the work items are unknown, do bounded discovery first, then build the workflow from the discovered items.",
  "Use `workflow` for broad parallel coverage, independent or adversarial verification, and work too large for one agent context; use `subagent` for one focused child or adaptive delegation where each result determines the next step.",
  "Before writing or resuming a workflow script, load the `workflow-dsl` skill for the script DSL: meta export, `agent()`/`parallel()`/`pipeline()`/`phase()` semantics, caps, resume, and `save_as`.",
];
