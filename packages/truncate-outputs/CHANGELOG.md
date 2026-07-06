# Changelog

## [Unreleased]

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- New `truncate-outputs` extension. Tool outputs that exceed a configurable byte threshold are written to a file under `/tmp` (configurable) and replaced with a message pointing the agent to the saved path and hinting it toward ranged `read` and `rg` to keep token usage down ([#33](https://github.com/earendil-works/pi-mono/issues/33)).
