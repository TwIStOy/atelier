export const WORKFLOW_TOOL_DESCRIPTION =
  "Run or resume a dynamic multi-agent workflow. Use only when the user explicitly requests workflow orchestration or invokes a skill or saved workflow that requires it.";

export const WORKFLOW_PROMPT_SNIPPET =
  "Run or resume an explicitly opted-in multi-agent workflow with generated JavaScript orchestration";

export const WORKFLOW_PROMPT_GUIDELINES = [
  "Invoke `workflow` only when the user explicitly requests workflow or multi-agent orchestration, asks to resume a workflow, or invokes a skill or saved workflow that requires it. Do not invoke `workflow` solely because parallelism might help.",
  "After workflow orchestration is opted into, prefer one `workflow` call over sequential `subagent` calls when the orchestration shape is known up front. If the work items are unknown, do bounded discovery first, then build the workflow from the discovered items.",
  "Use `workflow` for broad parallel coverage, independent or adversarial verification, and work too large for one agent context; use `subagent` for one focused child or adaptive delegation where each result determines the next step.",
  'Workflow scripts are JavaScript, not TypeScript. Their first statement must be exactly `export const meta = { name: "...", description: "..." }` with literal values only: no variables, calls, spreads, computed keys, methods, interpolation, or `__proto__`.',
  "Workflow scripts expose `agent(call)`, `parallel(fns)`, `pipeline(value, ...stages)`, `phase(title)`, `args`, and `console`. Host access through imports, `require`, `process`, `globalThis`, `global`, `module`, `exports`, `__dirname`, `__filename`, `eval`, `Function`, and `WebAssembly` is rejected.",
  '`workflow` agent calls use `agent({ label, task, agent_type?, model?, thinking?, inherit_context?, isolated?, max_turns?, schema? })`. Each call resolves to final text, or to a parsed value when `schema` is a JSON Schema with top-level `type: "object"`.',
  "In `workflow`, `agent_type` selects a persona from the <subagents> catalog when available; omit it for a general-purpose agent. Unknown ids fall back to general-purpose.",
  "In workflow scripts, `parallel([...])` is a barrier: it starts zero-argument branch functions concurrently, waits for all of them, and returns results in input order. Pass thunks such as `() => agent({...})`, never already-created promises.",
  "In workflow scripts, `pipeline(value, ...stages)` runs stages sequentially and passes each result to the next stage. For independent per-item chains, put a pipeline inside each parallel branch; add a shared barrier only when later work needs all results for merging, deduplication, judging, or early-exit decisions.",
  'In workflow scripts, call `phase("title")` before the agents it should group in the progress UI; skipped branches never render as empty phases.',
  "Pass workflow `args` as actual structured JSON values—objects, arrays, or scalars—not JSON-encoded strings.",
  "In workflow scripts, a failed `agent()` resolves to `null`; always null-check before using it. Invalid workflow DSL arguments and script errors fail the run, so synthesis must tolerate missing child results.",
  "For high-confidence workflow results, give agents independent perspectives and include an adversarial verifier or final judge when appropriate. Report sampling, top-N cutoffs, skipped items, and other coverage bounds rather than implying exhaustive coverage.",
  "End workflow orchestration with a final synthesis agent that receives collected results when interpretation is needed; otherwise return a plain-object summary from the script.",
  "Keep workflow agent counts small (default caps: 4 concurrent, 32 total per workflow); use loops and conditionals freely—the runtime enforces the caps.",
  "Every workflow result carries a `run_id`. Resume an aborted or failed run with `resume_run_id` and omit `script`; agents before the first unfinished one replay from cache, and everything after it re-runs.",
  "When the user asks to keep a workflow for reuse, set `save_as` on its first run or re-run it with `save_as`. Saved workflows become slash commands after `/reload` and accept structured JSON through `args`; use `save_scope` to choose user or project scope.",
];
