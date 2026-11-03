# Changelog

Releases before this consolidation describe the former `user-input-history` package.

## [Unreleased]

### Changed

- Split history payload parsing, disk/memory merging, and skim search/filtering internals into smaller helpers to clear `fallow health` complexity findings; behavior is unchanged.

## [0.7.0] - 2026-10-30

### Breaking Changes

- Replace `@htwang-contrib/user-input-history` with `@htwang-contrib/better-editor` under `extensions/better-editor`. The disable flag is now `better-editor`.
- Move `statusline.borderColor` and `experience.doubleEscapeEnabled` / `doubleEscapeDebounceMs` to the `better-editor` configuration namespace. Set custom values under `/config` -> BetterEditor.

### Added

- Own the custom input box previously supplied by `statusline`: rounded borders, prompt prefix, model and thinking level, context usage, session cost, working directory, and shared editor hints.
- Own the double-Escape abort controller previously supplied by `experience`, including autocomplete dismissal and timer cleanup.

### Changed

- Install the editor, prompt history, and interrupt handling through a single editor factory, independent of `statusline` and `experience` load order.
- Keep the existing prompt history cache, 1000-entry limit, single-line arrow navigation, Ctrl+R search, and input-event persistence.
- Display the active thinking level in parentheses after the model name, including minimal and medium, without the brain icon.

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.2.6] - 2026-07-16

### Fixed

- History file locking now passes a plain `fs` object to `proper-lockfile`, avoiding a Proxy invariant crash when the runtime wraps Node's `fs` module (`mtime-precision` cache Symbol).

## [0.2.5] - 2026-07-14

### Fixed

- Multi-line prompts are now flattened to a single line when navigating up/down through history, so previously-submitted multi-line entries no longer render as multiple editor lines while browsing ([#51](https://github.com/TwIStOy/pi-extensions/issues/51)).

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

### Added

- Emits an `extension loaded` log line when the extension initializes.

### Changed

- History persist failures now use the shared logger (`createLogger("user-input-history")`, `logger.error`) instead of `console.error`, which corrupts the pi TUI.

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Changed

- Now wraps the active editor factory via `chainEditorFactory` (`@htwang-contrib/common`) instead of a private `unwrapBaseFactory`/prior-marker scheme. Behavior is unchanged for the single-wrapper case and is now correct under multi-level editor wrapping. Adds `@htwang-contrib/common` as a dependency.
