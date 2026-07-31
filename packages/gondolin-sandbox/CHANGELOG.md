# Changelog

## [Unreleased]

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- New `gondolin-sandbox` extension. When enabled via `/config`, pi's `read`, `write`, `edit`, and `bash` tools (plus user `!` commands) execute inside a local Gondolin micro-VM (QEMU, Alpine Linux). The host working directory is mounted read-write at `/workspace` in the guest. Optional HTTP egress allowlist and per-session VM sizing (image, memory, cpus) are exposed through the standard ConfigItem UI. Disabled by default.
