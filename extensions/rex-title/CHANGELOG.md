# Changelog

## [Unreleased]

### Added

- Added `/rex-title` to summarize the current session and rename the originating Rex pane. Titles refresh automatically after every user-message run using all user messages on the active branch.
- Added the `/config` → **Rex Title → Title Model** select for a dedicated title model; the default follows the active session model.

### Fixed

- Title Model options now read the live model registry, including Magpie models registered asynchronously after `session_start`.
