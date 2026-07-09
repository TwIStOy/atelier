# Changelog

## [Unreleased]

## [0.2.4] - 2026-07-09

### Added

- Footer git branch/dirty status can now be disabled via `/config` -> Statusline -> "Show Git Branch" (default on). Useful in large repos where `git status` slows down the footer.

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- `MyEditor` now renders transient hint messages inside its top border. It subscribes to the shared `EDITOR_HINT_EVENT` channel (`@htwang-contrib/common`) once per session and renders the most recent active hint (default color `warning`) between the usage and model labels, preserving the rounded corners and labels. Other extensions can publish hints (e.g. `experience/double-escape` shows `esc again to abort`) without replacing the editor.

### Changed

- The editor factory installed by `session_start` is now tracked so the active `MyEditor` instance receives hint events, and the subscription is torn down on `session_shutdown`.
