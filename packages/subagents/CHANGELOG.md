# Changelog

## [Unreleased]

### Fixed

- `git_clone` abort no longer hangs the subagent run forever. `runGit` previously SIGKILLed only the direct `git` child and waited for the `close` event; a stalled clone leaves `git-remote-http` grandchildren holding the inherited stdio pipes, so `close` never fired, the tool promise never settled, and neither the child session's `abort()` nor the parent's Esc/RPC abort could unblock the run (the parent agent stayed wedged on the pending tool call). `runGit` now spawns `git` in its own process group (`detached: true`), on abort SIGKILLs the whole group, and rejects immediately instead of waiting for pipe closure. Regression test aborts a real clone against a never-responding HTTP server and asserts prompt settlement plus no surviving `git` processes.

## [0.6.0] - 2026-08-19

### Changed

- Parent-session feature prompt + persona catalog now register through `@htwang-contrib/common`'s contribution registry (`priority` 100, see `docs/common/SYSTEM-PROMPT-PRIORITIES.md`) instead of returning `{ systemPrompt }` from `before_agent_start`.

## [0.5.0] - 2026-08-12

### Changed

- Shipped personas moved from `packages/subagents/src/agents/` to the monorepo root `agents/` (registered via the root `package.json` `pi.agents`). Discovery is unchanged because `@htwang-contrib/common`'s catalog now includes that shared directory by default; `src/agent-catalog.ts` no longer injects a package-local shipped dir, and this package's `pi.agents` manifest entry was removed.


- Child-session link-record helpers (`recordSubagentStarted`/`appendSubagentLinkRecord`/`subagentParentIndexPath`) moved to `@htwang-contrib/common` (`src/agents/session-links.ts`) as `recordChildSessionStarted`/`recordChildSessionFinished`/`childSessionIndexPath`; `runSubAgent` and the viewer import them from common. `src/paths.ts` now only holds `SUBAGENT_SESSION_DIR`. No behavior change.
- `defaults_by_agent_type` parsing/resolution in `settings.ts` now delegates to `@htwang-contrib/common` (`agents/persona-defaults.ts`); the settings file location and precedence are unchanged.
- The persona catalog (`src/agent-catalog.ts`), child tool allowlists (`src/child-tools.ts`), and the `runSubAgent` execution core (`src/run-agent.ts`) moved to `@htwang-contrib/common` (`agents/agent-personas.ts`, `agents/child-tools.ts`, `agents/child-agent.ts` as `runChildAgent`) so the new `workflow` extension shares the same runner. `src/agent-catalog.ts` remains as a thin wrapper that injects this package's shipped `agents/` directory and keeps the existing `Subagent*` names; `run-agent.ts` keeps its exported surface (`runSubAgent`, `RunSubAgentInput`, `SubagentRunDetails`, message helpers) as a delegating alias. Child sessions now also exclude the `workflow` tool alongside `subagent`/`subagent_status`. No behavior change for `subagent` callers.

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.3.1] - 2026-07-30

### Fixed

- Accept `thinking: "max"` for subagents. The `THINKING_LEVELS` set in `run-agent.ts` stopped at `xhigh`, so `parseThinking` silently rejected `max` (added to pi's `ThinkingLevel` in 0.80) and the run fell back to the default — even though `inference-self-host`'s GLM-5.2 and DeepSeek thinking-level maps already handle `max`. `max` is now admitted, and both `thinking` tool-parameter descriptions enumerate the valid levels.
- Report a failed final assistant turn as an error instead of a silent success. `extractAssistantText` walked back past an empty failed final turn and returned an *earlier* turn's text as the answer, so a run whose final turn hit a provider error (`stopReason "error"`) or the output-token ceiling with no text (`stopReason "length"`) surfaced as `completed` with a stale or empty result. A new `finalTurnError()` flags those two stop shapes; `runSubAgent` now sets `isError`/`errorMessage` accordingly, and any text the run did produce is still surfaced as partial output (single + batch paths). A clean stop, a tool-call-only/thinking-only ending, and a `length` stop that *did* produce text all stay `completed`.

## [0.3.0] - 2026-07-23

### Fixed

- Register the `inference-self-host` and `inference-v2-self-host` providers inside child (subagent) sessions. Child sessions build a fresh `ModelRuntime` with `noExtensions: true` and only a fixed set of extension factories, so providers registered in the parent were never available to subagents, and personas hardcoding `inference-self-host/deepseek-v4-flash` failed with `No API key found for inference-self-host`.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Added `git_clone` tool (child-session only): clones a remote Git repository (HTTPS or git protocol only) into a managed cache under `/tmp/scout-cache/<owner>-<repo>`. Shallow by default (`--depth 1`); reuses an existing cache as-is. Rejects `file://`, `git+ssh://`, and `ssh://` URLs and runs with `GIT_TERMINAL_PROMPT=0` (no interactive auth). Registered only inside child (subagent) sessions via `CHILD_SESSION_EXTENSION_FACTORIES`, so the primary agent never exposes it.
- Added `scout` subagent persona: read-only agent for external docs and dependency research. Investigates third-party libraries, upstream repositories, and external documentation by cloning repositories into the managed cache (via `git_clone`) or reading docs with `web_search`/`web_fetch`. Counterpart to the local `explore` agent. Runs `isolated: true` with an explicit tool allowlist.

### Changed

- `resolveChildToolNames` now lets a persona declare non-built-in tools (e.g. `git_clone`) that are added on top of the allowed set, while still forbidding `bash`/`edit`/`write` when `isolated: true`. Previously any persona-declared tool not in the built-in read-only/full set was dropped.
