# Changelog

## [Unreleased]

### Added

- Report session moments through the htw daemon's event ingestion surface
  (`POST /v1/events`, ADR-0004): `session_started`, `user_prompt`,
  `thinking_started`/`thinking_finished`, `tool_started`/`tool_finished`,
  `waiting_for_user`, `turn_completed`/`turn_failed`, `session_ended`, each
  envelope carrying the full remembered-attribute set (project, model, title,
  pid, tmux_pane, cost, context, diff, worktree, started_at, host).
- Report the session `host` on both surfaces (`os.hostname()`).
- Snapshot reports now carry `last_user_input` and `thinking`.

### Changed

- Snapshot heartbeat cadence lowered from 5s to 60s; moments are reported as
  events and the heartbeat snapshot is now a liveness keepalive and
  convergence channel for the daemon's 120s active window.
- Snapshot `id` is now the composite `pi/<sessionId>`, matching the event
  surface's session key so both surfaces fold into one daemon session.
- `waiting_for_user` now derives from pi's native `ui_prompt_start` (all
  blocking UI prompts) instead of the common `MODAL_ACTIVE_EVENT` channel.
- Turn outcome is taken at `agent_settled` (after retries, compaction and
  queued continuations) with `turn_failed` reserved for a final assistant
  `stopReason === "error"`; user aborts map to `turn_completed`.

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.3.1] - 2026-07-30

### Added
- Populate the new `agent` and `title` Report fields. `agent` is always `"pi"`;
  `title` is the session name (else the first user prompt), omitted when unknown.

## [0.1.0] - 2026-07-22

### Added

- Initial release. Pushes full-state session Reports to the `htw daemon`
  producer HTTP API (`POST /v1/reports`) so live pi sessions show up in the
  `htw agents` dashboard.
