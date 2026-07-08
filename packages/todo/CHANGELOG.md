# Changelog

## [Unreleased]

### Changed

- `todo update` with only an `id` (and no mutable field) now defaults `status` to `in_progress` instead of erroring with "update requires at least one mutable field". Models frequently emitted bare `update {id}` (and list-only noise like `includeDeleted: false`) when intending to start work, which previously failed and could spam hundreds of identical errors in a single turn. Explicit mutable fields, transition validation, and all other error paths (`id required`, `#id not found`, illegal transitions) are unchanged.

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Fixed

- Fixed a type error that broke `tsc --build`: the `call` test helper now returns a typed result (`TodoCallResult`) instead of `unknown`, so accessing `.details` / `.content` no longer requires `as TaskDetails` casts.
