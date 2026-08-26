# Changelog

## [Unreleased]

### Added

- `grep`, `find`, and `ls` tools are now rewired when the sandbox is enabled. `ls` routes `stat`/`readdir` through `vm.fs`; `grep` routes directory checks and context-line reads through `vm.fs` (the `rg` search process itself still runs on the host over the mounted workspace — pi's grep tool spawns it outside the operations interface, results are identical since `/workspace` is host-backed).

### Changed

- `find` runs `fd` **inside the guest** with the same argument construction as pi's host implementation, restoring full fd semantics (including `.gitignore` awareness inside git repos). Requires the new default `alpine-tools:latest` image — the `alpine-base` recipe plus `fd` and `ripgrep`; build config under `image/build-config.json`, build once via `gondolin build --config ... --tag alpine-tools:latest`. The previous hand-rolled glob walker and the `picomatch` dependency were removed.
- Default `image` changed from `alpine-base:latest` to `alpine-tools:latest`.
- File operations (`read`, `write`, `edit`) now go through Gondolin's `vm.fs` API instead of shell exec (`cat`, `base64` pipelines, `test -r`). For paths under `/workspace` these calls short-circuit straight to the host-side `RealFSProvider`, skipping the guest VM entirely.
- `detectImageMimeType` now guesses from the file extension instead of running `file --mime-type` in the guest (temporary; tracked in [#132](https://github.com/TwIStOy/pi-extensions/issues/132)).

### Fixed

- Removed hand-rolled shell quoting (`shQuote`) from file operations; guest paths are no longer interpolated into shell scripts.
- `edit` access check now verifies write permission (`W_OK`) in addition to read, matching the local tool behavior.

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
