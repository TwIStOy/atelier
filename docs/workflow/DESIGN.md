# workflow — Design

Dynamic multi-agent orchestration, ported from [Michaelliv/pi-dynamic-workflows](https://github.com/Michaelliv/pi-dynamic-workflows) (behavior/API reference) and rebuilt against this monorepo. Lives in `packages/workflow/`.

## Core idea

A `workflow` tool whose single parameter is a **JavaScript script written by the model at call time**. The script composes isolated child-agent runs with `agent()` / `parallel()` / `pipeline()` / `phase()`; the runtime validates, sandboxes, schedules, and aggregates. One tool call replaces many orchestrating LLM turns when the fan-out shape is known up front.

`workflow` complements `subagent` rather than replacing it: `subagent` stays the right tool for adaptive delegation (parent decides step-by-step) and background jobs.

## Relationship to subagents and common

```
packages/common
  agent-personas.ts   persona Markdown catalog (promoted from subagents; shippedDirs injectable)
  child-tools.ts      child tool allowlists; excludes subagent/subagent_status/workflow
  child-agent.ts      runChildAgent — generalized subagents run-agent.ts;
                      adds outputSchema → structured_output custom tool (terminate: true)
packages/subagents    runSubAgent = runChildAgent + own extension factories + own session dir
packages/workflow     workflow tool = script engine + runChildAgent + own session dir
```

Both orchestrators share one runner, so personas, usage accounting, by-parent link records, and the `/view-subagents` viewer behave identically for both. Child sessions never receive either orchestration tool (no recursive fan-out).

## Script pipeline

1. **Normalize** — strip optional ```js fences (`script.ts`).
2. **Parse** — acorn, `sourceType: "module"`, `allowReturnOutsideFunction` (top-level `return` sets the workflow result).
3. **Validate** —
   - first statement is exactly `export const meta = { name, description }`; it is the only allowed export; no imports;
   - `meta` is extracted by **AST literal evaluation** (no code execution): literals, arrays, nested objects, `-/+` numbers, plain template strings; spread / computed keys / methods / `__proto__` are rejected;
   - banned host references anywhere in the AST: `require`, `process`, `globalThis`, `global`, `eval`, `Function`, `WebAssembly`, `module`, `exports`, `__dirname`, `__filename`, dynamic `import()`. Property keys/member accesses with those names stay legal.
4. **Rewrite** — the `export ` prefix is sliced off (ranges from the AST), leaving `const meta = ...` visible to the script body.
5. **Execute** — `node:vm` context (`"use strict"`, async-function wrapper) with injected globals only. `vm` is **not** a hard security boundary (constructor-chain escapes exist); it is a guard rail for model-generated code, which is the only script source.

## Runtime semantics (`engine.ts`)

- `agent(call)` validates arguments (throwing on script bugs), registers a snapshot entry (`queued` → `running` → `done`/`error`/`aborted`), and runs through a global semaphore (`maxConcurrency`, default 4). A hard `maxAgents` cap (default 32) fails the whole run when exceeded. Child failures resolve to `null` and are logged — sibling agents are unaffected.
- `parallel(fns)` requires zero-arg functions; passing a promise gets a targeted "wrap the call in `() => ...`" error. Order is preserved.
- `pipeline(value, ...stages)` threads results sequentially.
- `phase(title)` closes the previous phase and groups subsequent agents; phases are recorded at runtime so skipped branches never render.
- `console.*` appends to a capped in-memory log (200 lines) shown in the UI.
- Abort (Esc → tool `signal`) marks queued/running agents `aborted`, aborts in-flight child sessions through signal forwarding, and settles the run as `aborted`. Note: a synchronous infinite loop in script code cannot be preempted (single thread); guidelines tell the model to avoid unbounded sync loops.
- The runner is dependency-injected (`WorkflowAgentRunner`), so engine tests run without real sessions.

## Structured output

`agent({ ..., schema })` (JSON Schema, top-level `type: "object"`) wraps the schema in `Type.Unsafe` and registers a `structured_output` custom tool in the child session. The child is instructed to submit its final answer through it; the tool captures the validated arguments and returns `terminate: true`, ending the session without a trailing assistant turn. `agent()` then resolves to the parsed value. A child that never calls it is an error.

## Display

One snapshot model (`WorkflowSnapshot`: phases, agents, capped logs, status) feeds two renderers (`display.ts`):

- **TUI** — `ctx.ui.setWidget(key, lines, { placement: "belowEditor" })`, throttled to ~100 ms with a trailing update; final state stays visible 15 s, then the widget clears.
- **No UI** — throttled `onUpdate` partial results with the same rendered lines and the raw snapshot in `details`.

## Persistence and resume

**Saved scripts** (`script-store.ts`): `*.js` files discovered from `~/.config/pi/workflows` (user) and `<cwd>/.pi/workflows` (project; wins on name conflicts), validated with the same parser. `save_as` on a successful run writes the script atomically (tmp + rename, symlink-refusing) and it becomes a slash command on the next `session_start` (re-registration is overwrite-safe). Command arguments are JSON-parsed and exposed as `args`. The `/workflows` picker lists saved commands (run with args input) and resumable runs.

**Run records** (`run-store.ts`): every run writes `~/.agent/workflow/runs/<id>.json` at start, after each settled agent (`onAgentSettled` from the engine), and at finish; newest 20 are kept. A record holds the script, args, status, and per-agent outcomes keyed by invocation sequence.

**Resume semantics** (mirrors Claude Code): replay follows agent **start order**. `resumeCheckpoint(agents)` finds the first sequence without an `ok` record; only agents before it may be served from cache, and only when the replayed call deep-equals the recorded one — everything after re-runs even if it completed. In-flight agents at abort time are never cached, so pausing mid fan-out discards their partial work by design. Cached agents appear in snapshots with `cached: true`.

## What we deliberately dropped from the upstream prototype

- `Date.now`/`Math.random` determinism bans (no replay/persistence exists to justify them).
- Token-budget estimation by `length / 4` (we have real usage accounting from the child sessions).
- The `modelRegistry` pass-through (drifted out of newer pi; the shared runner uses `ModelRuntime.create()`).

## Known limitations

- `vm` sandbox escapable by a determined script; acceptable while scripts are model-generated, revisit before accepting user-supplied scripts. Saved workflow commands raise the stakes slightly (a saved script is user-reviewed, but edits to `.js` files on disk are arbitrary code) — the save path refuses symlinks, nothing more.
- No wall-clock timeout (per-call `max_turns` and Esc remain the guards).
- Every `agent()` creates a fresh child session (no pooling); fan-out beyond the caps should batch work into fewer agents.
- Resume replays the script, so scripts must be deterministic up to the resume point (`Date.now()`/randomness/side effects diverge); the call deep-equal check catches changed `agent()` calls, not changed control flow.
