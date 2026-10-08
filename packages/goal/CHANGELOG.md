# Changelog

## [Unreleased]

### Added

- `create_goal` / `update_goal` / `get_goal` declare MCP-style annotations (`get_goal` read-only; `update_goal` idempotent).

### Changed

- The goal verifier's child session now reads the shared child-extension registry (`getChildExtensionFactories` from `@htwang-contrib/common`) instead of hardcoding `protect-secrets` + `extra-tools`. The verifier tool allowlist (`read` / `bash` / `grep` / `glob` / `ls`) still gates which tools exist; extension event handlers (e.g. `protect-secrets`' `tool_call` guard) now match whatever the parent session loaded.

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

### Added

- `/create-goal <task>` prompt template that expands a plain task into a strict evidence-based completion contract (outcome, verification evidence, constraints, iteration policy, completion audit, blocked-stop) before calling `create_goal`.
- Error recovery: an active goal now auto-pauses after a configurable number of consecutive provider errors at `agent_end` (`maxConsecutiveErrors`, default 3) instead of looping forever. Auto-continuation is suppressed on error turns and resumed on success or user input.
- Stale-continuation guard: hidden goal continuation prompts are debounced per goal and cleared on turn start and goal transitions, preventing pile-ups and stale re-fires after a goal is replaced, cleared, or completed. Budget-limit prompts are now sent once per budget-limited episode.
- Continuation and budget prompts are wrapped in a `<pi_goal_continuation goal_id="...">` marker and carry the goal id in their message details.

### Changed

- The continuation prompt now requires a full completion audit (requirement-to-evidence checklist) and reminds the agent that `update_goal` launches an independent verification agent.

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Fixed

- The Goal status bar running time now ticks live while a goal is active instead of staying frozen between turns. The widget recomputes elapsed time from `lastStartedAt` on every render and requests a re-render once per second.
- The elapsed time shown when a goal completes now includes the in-progress interval. Previously `timeUsedSeconds` was only accumulated at `agent_end` / `session_shutdown`, so completing a goal mid-turn dropped the time spent during the finishing turn.
- Elapsed time now only advances while the session is live. Resuming an active goal after the session was closed rebases the timer to now instead of silently counting the offline gap as run time.

### Changed

- Goal time accounting is unified on `lastStartedAt`. `timeUsedSeconds` holds accumulated closed intervals; the live active interval is derived from `lastStartedAt` and folded in on pause / completion / budget-limit / shutdown. Token accounting and the budget-limited transition are unchanged.
