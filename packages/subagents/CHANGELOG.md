# Changelog

## [Unreleased]

### Added

- Added `scout` subagent persona: read-only agent for external docs and dependency research. Investigates third-party libraries, upstream repositories, and external documentation by cloning repositories into a managed cache (via the dedicated `git_clone` tool) or reading docs with `web_search`/`web_fetch`. Counterpart to the local `explore` agent.

### Changed

- `resolveChildToolNames` now lets a persona declare non-built-in tools (e.g. `git_clone`) that are added on top of the allowed set, while still forbidding `bash`/`edit`/`write` when `isolated: true`. Previously any persona-declared tool not in the built-in read-only/full set was dropped.
