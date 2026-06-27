# Changelog

## [Unreleased]

### Added

- Added `git_clone` tool: clones a remote Git repository (HTTPS or git protocol only) into a managed cache under `/tmp/scout-cache/<owner>-<repo>`. Shallow by default (`--depth 1`); reuses an existing cache as-is. Rejects `file://`, `git+ssh://`, and `ssh://` URLs and runs with `GIT_TERMINAL_PROMPT=0` (no interactive auth). Intended for the `scout` subagent to inspect upstream dependency source read-only.

### Fixed

- Fixed a type error that broke `tsc --build`: import `Stats` from `node:fs` instead of `node:fs/promises` (no longer re-exported by `@types/node`).
