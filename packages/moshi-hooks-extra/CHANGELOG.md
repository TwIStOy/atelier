# Changelog

## [Unreleased]

### Added

- Emits an `extension loaded` log line when the extension initializes.

### Changed

- Z.AI usage snapshots pushed to Moshi now include only token (model) windows; the tool-call window (`TIME_LIMIT`) is excluded. Filtering lives in `buildZaiRawSnapshot` / `buildZaiSnapshot` (by `kind` / `window`), and the raw event handler skips the push when no token window is present.
- `resolveStateDir` is now imported from `@htwang-contrib/common` instead of being defined locally in `moshi-secrets.ts`. Behavior is unchanged for callers.

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Initial release.
