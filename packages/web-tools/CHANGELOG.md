# Changelog

## [Unreleased]

### Added

- Emits an `extension loaded` log line when the extension initializes.

### Changed

- The `gh` CLI availability hint now uses the shared logger (`createLogger("web-tools")`, `logger.warn`) instead of `console.error`, which corrupts the pi TUI.

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Initial release.
