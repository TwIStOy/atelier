# Changelog

## [Unreleased]

## [0.2.2] - 2026-07-07

### Added

- Depends on `@htwang-contrib/common`. Emits an `extension loaded` log line when the extension initializes.

### Changed

- `fetchModels` "model not found" warnings now use the shared logger (`createLogger("inference-self-host")`, `logger.warn`) instead of `console.warn`, which corrupts the pi TUI.

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Initial release.
