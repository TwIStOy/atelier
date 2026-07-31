# Changelog

## [Unreleased]

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- New `truncate-outputs` extension. Tool outputs that exceed a configurable byte threshold are written to a file under `/tmp` (configurable) and replaced with a message pointing the agent to the saved path and hinting it toward ranged `read` and `rg` to keep token usage down ([#33](https://github.com/earendil-works/pi-mono/issues/33)).
