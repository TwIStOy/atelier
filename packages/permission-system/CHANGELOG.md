# Changelog

## [Unreleased]

### Added

- Decision audit log: every allow/ask/deny decision is appended as JSONL to
  `~/.pi/agent/extensions/permission-system/logs/review.jsonl`, with a
  `decision` field distinguishing the path taken (`allow`, `ask-allowed`,
  `ask-denied`, `ask-headless-denied`, `deny`). Toggle with the new top-level
  `permissionReviewLog` config key (default on).
- The `ask` prompt now shows a **permanent-allow config snippet** (e.g.
  `bash: { "npm test *": "allow" }`) so the user knows exactly what to add to
  stop being asked. The hint reflects the surface that actually fired
  (`path` vs `external_directory`).
- Session approvals: an `ask` prompt now offers **Allow once**, **Allow
  always (session)**, and **Deny**. Choosing session scope remembers the
  decision for the rest of the pi session (by bash prefix / path / tool name),
  so repeated matching calls skip the dialog. Per-session only — nothing is
  written to disk.

### Fixed

- Confirmation prompts now lead with the **tool name** (e.g. `memory-read`,
  `bash: rm <path>`) so the user knows what they are approving. A non-path
  custom tool previously prompted as a vague `read (no specific path or
  command)`.
- Pipeline now aggregates all gate results into one most-restrictive decision
  (deny > ask > allow) and prompts **once** per call. Previously a tool call
  matching two `ask` gates (e.g. an external-directory write) prompted twice.
- Bash command prompts now show the full command (e.g. `bash: rm <path>`)
  instead of just the subcommand prefix (`bash: rm`).

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
