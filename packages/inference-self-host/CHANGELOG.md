# Changelog

## [Unreleased]

### Added

- `kimi-k3` (prices synced from models.dev, Moonshot family).

## [0.2.5] - 2026-07-14

### Added

- GPT-5.6 family models: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` (prices synced from models.dev).
- `grok-4.5` (prices synced from models.dev, provider `xai`).

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

### Added

- Depends on `@htwang-contrib/common`. Emits an `extension loaded` log line when the extension initializes.

### Changed

- `fetchModels` "model not found" warnings now use the shared logger (`createLogger("inference-self-host")`, `logger.warn`) instead of `console.warn`, which corrupts the pi TUI.

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Initial release.
