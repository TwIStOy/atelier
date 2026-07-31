# Changelog

## [Unreleased]

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Fixed

- The `/config` popup no longer overflows the terminal and clips its title. The setting list previously ignored its row budget: group headers (one per extension), the selected row's description, and the scroll indicators were all rendered on top of the budgeted rows, so the popup grew to `bodyRows + N` and its top was pushed off-screen. The list now treats its budget as a hard physical-line cap (headers, description, and indicators all count against it), and the scroll position re-anchors so the selected row stays visible.
- The popup height now actually honors the configured maximum. `computeLayout` previously ignored `DEFAULT_MAX_HEIGHT` and used `terminalRows - 2`, leaving the constant as dead code; it now derives the height from a single `DEFAULT_MAX_HEIGHT_PCT` source of truth.

### Changed

- The default max popup height is now ~50% of the terminal (capped at 26 rows), down from ~85% / 40 rows, so the popup no longer fills the screen. Tunable via `DEFAULT_MAX_HEIGHT_PCT` (`packages/extension-config-ui/src/types.ts`).
