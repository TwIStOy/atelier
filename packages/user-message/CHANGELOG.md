# Changelog

## [Unreleased]

### Fixed

- The user-prompt `▌` bar now maps the `max` thinking level to the `thinkingMax` theme color. The level switch predated the `max` level, so running at `max` fell through to the default `thinkingOff` and every prompt bar rendered gray.

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
