# Changelog

## [Unreleased]

### Added

- New `gondolin-sandbox` extension. When enabled via `/config`, pi's `read`, `write`, `edit`, and `bash` tools (plus user `!` commands) execute inside a local Gondolin micro-VM (QEMU, Alpine Linux). The host working directory is mounted read-write at `/workspace` in the guest. Optional HTTP egress allowlist and per-session VM sizing (image, memory, cpus) are exposed through the standard ConfigItem UI. Disabled by default.
