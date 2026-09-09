# Changelog

## [Unreleased]

### Added

- Optional extended `bash` tool that replaces the built-in bash (same override mechanism as `ls`/`grep`/`glob`). The extended schema adds a **required** `description` parameter — a brief human-readable summary of the command — which the tool-display bash adapter renders as the call header (`Bash <description>`, command hidden until expanded). Execution delegates to pi's `createBashToolDefinition`, so process management, output truncation, temp-file persistence, `PI_*` env, and native renderers are unchanged. Controlled by the new `extendedBash` boolean config item (default on, `/config` → Extra Tools; takes effect after `/reload`).

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Fixed

- Fixed a type error that broke `tsc --build`: import `Stats` from `node:fs` instead of `node:fs/promises` (no longer re-exported by `@types/node`).
