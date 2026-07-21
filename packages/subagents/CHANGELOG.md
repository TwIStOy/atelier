# Changelog

## [Unreleased]

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
