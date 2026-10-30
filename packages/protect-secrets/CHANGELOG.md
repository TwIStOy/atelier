# Changelog

## [Unreleased]

## [0.7.0] - 2026-10-30

### Added

- The extension now self-registers into the shared child-extension registry (`registerChildExtensionFactory` from `@htwang-contrib/common`), so `subagent` / `workflow` / goal-verifier child sessions enforce the same protected-path guards whenever the extension is loaded in the parent session. Previously children received it through a hardcoded list inside the `subagents` package, regardless of what the parent loaded.

## [0.6.0] - 2026-08-19

### Added

- Project-local config at `<project>/.pi/extensions/protect-secrets/config.json` with a `protectedPaths` array to protect extra paths beyond the built-in `/run/agenix`. Entries may be absolute, `~/`-prefixed, or relative to the project root (the directory containing `.pi`; the config is discovered by walking up from the session cwd). The file is re-read when it changes (mtime/size-cached), and malformed configs surface a warning on session start.

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Initial release.
