# Changelog

## [Unreleased]

### Breaking Changes

- The title-generation config moved to the shared `session-title` config section (`/config` → Session Title): `herdr.model` is now `session-title.model`. `herdr.enabled` remains and now gates only the tab renaming, not title generation (which `htw-producer` may still request).

### Changed

- Title generation is now shared via `@htwang-contrib/common`'s session-title service: the title is generated once per process and reused by every consumer (herdr tab title, htw-producer reports) instead of per-extension.
- Removed `src/summarizer.ts`; the first-prompt title generation lives in `@htwang-contrib/common`.

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

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
