# Changelog

## [Unreleased]

### Fixed

- Fixed a type error that broke `tsc --build`: import `Stats` from `node:fs` instead of `node:fs/promises` (no longer re-exported by `@types/node`).
