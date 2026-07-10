# Changelog

## [Unreleased]

### Fixed

- Pipeline now aggregates all gate results into one most-restrictive decision
  (deny > ask > allow) and prompts **once** per call. Previously a tool call
  matching two `ask` gates (e.g. an external-directory write) prompted twice.
- Bash command prompts now show the full command (e.g. `execute: rm <path>`)
  instead of just the subcommand prefix (`execute: rm`).

### Added

- Extension wiring: `tool_call` handler runs the five-gate pipeline (path →
  external_directory → bash-path → bash-external_directory → tool), parses a
  bash command once via tree-sitter, and prompts on `ask` via `ctx.ui.confirm`.
  Headless sessions (`ctx.hasUI === false`) fail closed (ask → deny).
- `session_start` loads + deep-merges global/project JSONC config and caches the
  resolver + path normalizer per session.
- Registered in the root `package.json` `pi.extensions` list.
- README + `docs/permission-system/CONFIG.md` configuration reference.

## [0.2.4] - 2026-07-09

### Added

- Initial release.
