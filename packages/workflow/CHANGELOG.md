# Changelog

## [Unreleased]

### Changed

- Split the `workflow` prompt guidelines: the system prompt keeps only the invocation policy (explicit opt-in, when to prefer `workflow` over `subagent`) plus a pointer to the new `workflow-dsl` skill; the script DSL mechanics (meta literal format, injected globals and host-access rejection, `agent()` call shape, `parallel`/`pipeline`/`phase` semantics, `null` failure handling, concurrency caps, resume, and `save_as`) moved into `skills/workflow-dsl/SKILL.md`, loaded on demand via the skill catalog. Guidelines shrink from 3.8k to 0.9k characters; net system-prompt saving is ~2.5k characters per session after the new skill catalog entry.
- Both display factories share one `ThrottledPush` (interval coalescing + trailing timer) instead of duplicated throttle plumbing per factory. Dead exports removed (`savedWorkflowDirs`, `savedWorkflowDirForScope`, `workflowRunsDir`).

## [0.7.0] - 2026-10-30

### Added

- The `workflow` tool declares MCP-style annotations (mutating, destructive, open-world).

### Changed

- Child sessions no longer hardcode `protect-secrets` / `extra-tools` / `web-tools` / `toori` (`WORKFLOW_CHILD_FACTORIES` removed, along with those package dependencies); children load the shared child-extension registry (`registerChildExtensionFactory` in `@htwang-contrib/common`), the same sourcing as `subagent` children. Those packages self-register when loaded in the parent session, so children see exactly the child-enabled extensions the parent loaded.

## [0.6.1] - 2026-09-01

### Changed

- Refined the `workflow` tool prompt with explicit opt-in, bounded discovery before dynamic fan-out, accurate `parallel` barrier and `pipeline` sequencing semantics, structured `args` guidance, failure handling, and honest coverage reporting.

### Removed

- Removed the `inference-self-host` provider from workflow child-session extension factories.

## [0.5.0] - 2026-08-12

### Added

- New `workflow` extension: a `workflow` tool that runs model-generated JavaScript orchestration scripts. The script's first statement must be `export const meta = { name, description }` (extracted by acorn AST literal evaluation, never executed); the body runs in a `node:vm` sandbox with injected `agent()` / `parallel()` / `pipeline()` / `phase()` / `args` / `console` globals and no host access (imports, `require`, `process`, `globalThis`, `eval`, `Function` are rejected at parse time). `agent()` calls are executed by the shared `runChildAgent` runner from `@htwang-contrib/common` — persona support via `agent_type`, per-call `model`/`thinking`/`isolated`/`max_turns`, real token-usage accounting, `~/.agent/workflow/session` child sessions, and by-parent link records so workflow children show up in `/view-subagents`. An optional JSON Schema `schema` turns the child into a structured-output producer (`terminate: true` `structured_output` tool) whose parsed value is returned to the script. Failed agents resolve to `null` without aborting the workflow. Live progress renders as a theme-colored `aboveEditor` widget in the TUI (event-driven with a 100ms throttle plus a spinner-rate (80ms) tick that also keeps the elapsed-time counter moving, auto-cleared after completion) or as streaming `onUpdate` partials without a UI; Esc aborts the workflow and all in-flight children. `maxConcurrency` (default 4) and `maxAgents` (default 32) are configurable via `/config`.
- Script persistence and resume. `save_as` / `save_scope` tool params write a successful run's script to `~/.config/pi/workflows/` (user) or `.pi/workflows/` (project); saved workflows become slash commands on the next `session_start` and accept JSON args via the `args` global. Every run persists state to `~/.agent/workflow/runs/<run_id>.json` (newest 20 kept) and every result carries a `run_id`; `resume_run_id` replays agents that completed before the first unfinished one from cache (call deep-equality required) and re-runs the rest, matching Claude Code's resume semantics. New `/workflows` command lists saved workflows (run with args) and resumable runs.
- `./script` package subpath export (`@htwang-contrib/workflow/script`) exposing the acorn script parser standalone, so `@htwang-contrib/tool-display` can resolve a call's `meta.name` for its `workflow` tool-row adapter without loading the full extension.
