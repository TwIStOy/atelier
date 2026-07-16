# Changelog

## [Unreleased]

## [0.2.6] - 2026-07-16

### Added

- AnySearch provider (`search` + `fetch`). Connects to the AnySearch MCP API at `https://api.anysearch.com/mcp`; API key is optional (anonymous access allowed, lower rate limits). Configure via env var `ANYSEARCH_API_KEY` or the `/config` UI.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

### Added

- Emits an `extension loaded` log line when the extension initializes.

### Changed

- The `gh` CLI availability hint now uses the shared logger (`createLogger("web-tools")`, `logger.warn`) instead of `console.error`, which corrupts the pi TUI.

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Initial release.
