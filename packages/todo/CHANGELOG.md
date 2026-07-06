# Changelog

## [Unreleased]

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Fixed

- Fixed a type error that broke `tsc --build`: the `call` test helper now returns a typed result (`TodoCallResult`) instead of `unknown`, so accessing `.details` / `.content` no longer requires `as TaskDetails` casts.
