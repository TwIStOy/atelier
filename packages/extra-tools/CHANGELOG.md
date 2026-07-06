# Changelog

## [Unreleased]

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Fixed

- Fixed a type error that broke `tsc --build`: import `Stats` from `node:fs` instead of `node:fs/promises` (no longer re-exported by `@types/node`).
