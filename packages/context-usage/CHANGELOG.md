# Changelog

## [Unreleased]

## [0.7.0] - 2026-10-30

### Changed

- `/context` reads the current model, thinking level, and context usage directly from Pi after removal of the `virtual-model` extension.
- `/context` is now registered only when pi runs in TUI mode (via `registerTuiCommands` from `@htwang-contrib/common`). The below-editor widget is registered as a component factory (ignored by the RPC widget bridge) and its Esc-clear relies on `onTerminalInput` (interactive-only), so the command was a silent no-op in RPC mode.

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
