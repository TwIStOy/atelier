# Changelog

## [Unreleased]

## [0.2.2] - 2026-07-07

### Added

- Emits an `extension loaded` log line when the extension initializes.

### Changed

- History persist failures now use the shared logger (`createLogger("user-input-history")`, `logger.error`) instead of `console.error`, which corrupts the pi TUI.

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Changed

- Now wraps the active editor factory via `chainEditorFactory` (`@htwang-contrib/common`) instead of a private `unwrapBaseFactory`/prior-marker scheme. Behavior is unchanged for the single-wrapper case and is now correct under multi-level editor wrapping. Adds `@htwang-contrib/common` as a dependency.
