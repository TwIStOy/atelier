# Changelog

## [Unreleased]

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

### Changed

- `/zai-usage` output regroups quota bars by their limit kind: the token windows (5h, weekly) now sit under **Model Usage**, and the tool-call window (monthly) under **Tool Usage**. Driven by the explicit `kind` on `CodingPlanUsageWindowRaw` instead of the legacy window enum.

### Fixed

- `TIME_LIMIT_5_1` (tool-call window) was labeled `weekly`; it is `monthly`. The raw usage path (`describeRawLimit`) now agrees with the display path (`classifyWindow`), both backed by a single fixed `(type, unit, number) -> period` table.

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Initial release.
