# Changelog

## [Unreleased]

## [0.5.0] - 2026-08-12

### Added

- `heap-probe` diagnostic command: inflates the JS heap by N MB without adding messages, to isolate GC (heap size) vs rendering (message count) as the cause of editor lag. `/heap-probe <MB>` to inflate, `/heap-probe 0` to release.
