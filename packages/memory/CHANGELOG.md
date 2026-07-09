# Changelog

## [Unreleased]

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Changed

- All memory/journal tools now honor the agent abort signal: pressing interrupt (`esc`) while a `memory-*` or `journal-*` tool is running now kills the underlying `hat` subprocess and stops the call immediately, instead of waiting for it to finish.
