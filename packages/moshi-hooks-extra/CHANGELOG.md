# Changelog

## [Unreleased]

### Removed

- Z.AI quota forwarding, its usage publisher, and the file/Keychain credential readers used only by that integration.

## [0.6.1] - 2026-09-01

### Added

- Added extension diagnostics for Moshi transport selection and Z.AI usage publishing, including the secret-redacted request URL, headers, body, response status, and failure reason.

### Fixed

- Pi session events now prefer `sessionManager.getSessionId()` over the transcript file path so the generated Moshi hook and `moshi-hooks-extra` update the same inbox row.

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

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
