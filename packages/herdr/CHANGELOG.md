# Changelog

## [Unreleased]

### Added

- Emits an `extension loaded` log line when the extension initializes.

### Changed

- Diagnostics now go through the shared `createLogger("herdr")` from `@htwang-contrib/common`, appending to the shared `pi/extensions.log` instead of a private `herdr.log`.

### Removed

- Local `src/log.ts` diagnostic logger — replaced by the shared `createLogger` from `@htwang-contrib/common`.

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Initial release.
