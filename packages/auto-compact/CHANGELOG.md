# Changelog

## [Unreleased]

### Fixed

- An unknown zero-sized context window no longer triggers immediate compaction or emergency truncation.

### Changed

- Compaction thresholds, retention budgets, and status output use Pi's context usage and model window directly after removal of the `virtual-model` extension.

### Added

- Idle compaction: after `idleCompactMinutes` (default 0 = off) of inactivity, the next `turn_start` (and session `resume`/`fork`) compacts before the request re-reads the whole context at full price. Guarded by a hardcoded 50%-of-window floor; the resume path compacts without sending a follow-up. `/auto-compact` status now shows the idle threshold and current idle gap. Decision record: `docs/auto-compact/adr/0001-idle-compaction-uses-semantic-summary.md`.

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
