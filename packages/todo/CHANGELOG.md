# Changelog

## [Unreleased]

### Fixed

- Fixed a type error that broke `tsc --build`: the `call` test helper now returns a typed result (`TodoCallResult`) instead of `unknown`, so accessing `.details` / `.content` no longer requires `as TaskDetails` casts.
