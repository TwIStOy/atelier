# Changelog

## [Unreleased]

## [0.2.7] - 2026-07-30

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
