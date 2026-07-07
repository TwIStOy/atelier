# Changelog

## [Unreleased]

### Fixed

- `moshi-hooks-extra` no longer crashes Pi with an uncaught "stale ctx" exception. The `agent_end` handler forwarded a captured `ctx` to a deferred `sendEnvelope` call that ran after an async summarization gap; if the session was replaced or reloaded in the meantime, Pi invalidates the captured ctx and reading any guarded accessor (`sessionManager`, `cwd`, `model`, ...) throws. `sendEnvelope` now snapshots the guarded ctx fields into a plain object at entry, and `agent_end` snapshots before the async gap, so no guarded getter is ever read after an `await`. A stale ctx degrades the payload's session id/cwd to fallbacks instead of throwing.

## [0.2.2] - 2026-07-07

### Added

- Emits an `extension loaded` log line when the extension initializes.

### Changed

- Z.AI usage snapshots pushed to Moshi now include only token (model) windows; the tool-call window (`TIME_LIMIT`) is excluded. Filtering lives in `buildZaiRawSnapshot` / `buildZaiSnapshot` (by `kind` / `window`), and the raw event handler skips the push when no token window is present.
- `resolveStateDir` is now imported from `@htwang-contrib/common` instead of being defined locally in `moshi-secrets.ts`. Behavior is unchanged for callers.

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Initial release.
