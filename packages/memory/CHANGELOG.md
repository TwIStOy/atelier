# Changelog

## [Unreleased]

### Changed

- All memory/journal tools now honor the agent abort signal: pressing interrupt (`esc`) while a `memory-*` or `journal-*` tool is running now kills the underlying `hat` subprocess and stops the call immediately, instead of waiting for it to finish.
