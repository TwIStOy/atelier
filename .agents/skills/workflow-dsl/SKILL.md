---
name: workflow-dsl
description: Write, resume, and save scripts for the pi `workflow` tool's JavaScript orchestration DSL. Use when the user asks for workflow or multi-agent orchestration, before writing or resuming a workflow script, or when saving a workflow for reuse.
---

# Workflow DSL

The `workflow` tool runs a model-generated JavaScript orchestration script in a `node:vm` sandbox, fanning work out to isolated child agents. This is the script DSL reference.

## Script format

- JavaScript, not TypeScript.
- The first statement must be exactly `export const meta = { name: "...", description: "..." }` with literal values only: no variables, calls, spreads, computed keys, methods, interpolation, or `__proto__`.
- The body runs as an async function; the top-level `return` value becomes the workflow result, reported back as JSON.

## Injected globals

`agent(call)`, `parallel(fns)`, `pipeline(value, ...stages)`, `phase(title)`, `args`, and `console` (log/info/warn/error, captured into the workflow log).

Host access is rejected: `import`, `require`, `process`, `globalThis`, `global`, `module`, `exports`, `__dirname`, `__filename`, `eval`, `Function`, and `WebAssembly`.

## agent() calls

`agent({ label, task, agent_type?, model?, thinking?, inherit_context?, isolated?, max_turns?, schema? })` resolves to the child's final text, or to a parsed value when `schema` is a JSON Schema with top-level `type: "object"`.

- A failed `agent()` resolves to `null`; always null-check results before use, and let synthesis tolerate missing child results.
- Invalid DSL arguments and script errors throw and fail the whole run with an actionable message.
- `agent_type` selects a persona from the <subagents> catalog; omit it for a general-purpose agent. Unknown ids fall back to general-purpose.

## parallel / pipeline / phase

- `parallel([...])` is a barrier: it starts zero-argument branch functions concurrently, waits for all of them, and returns results in input order. Pass thunks such as `() => agent({...})`, never already-created promises.
- `pipeline(value, ...stages)` runs stages sequentially, passing each result to the next. For independent per-item chains, put a pipeline inside each parallel branch; add a shared barrier only when later work needs all results for merging, deduplication, judging, or early-exit decisions.
- Call `phase("title")` before the agents it should group in the progress UI; skipped branches never render as empty phases.

## args

Pass workflow `args` as actual structured JSON values — objects, arrays, or scalars — not JSON-encoded strings.

## Quality and synthesis

- Give agents independent perspectives; include an adversarial verifier or final judge when high-confidence results matter. Report sampling, top-N cutoffs, skipped items, and other coverage bounds rather than implying exhaustive coverage.
- End with a final synthesis agent when interpretation is needed; otherwise return a plain-object summary from the script.
- Keep agent counts small: default caps are 4 concurrent and 32 total per workflow; the runtime enforces them.

## Resume and save

- Every workflow result carries a `run_id`. Resume an aborted or failed run with `resume_run_id` and omit `script`; agents before the first unfinished one replay from cache, everything after it re-runs.
- To keep a workflow for reuse, set `save_as` on its first run or re-run it with `save_as`. Saved workflows become slash commands after `/reload` and accept structured JSON through `args`. Use `save_scope` to choose `'user'` (`~/.config/pi/workflows`) or `'project'` (`.pi/workflows`).
