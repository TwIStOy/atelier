# Changelog

## [Unreleased]

### Added

- Added `/rex-title` to summarize the current session and set its native Pi session title. Titles refresh automatically after every user-message run using all user messages on the active branch.
- Added the `/config` → **Rex Title → Title Model** select for a dedicated title model; the default follows the active session model.

### Fixed

- Title Model options now read the live model registry, including Magpie models registered asynchronously after `session_start`.
- Title updates use `pi.setSessionName()` so Pi owns the terminal title and OSC 7501 lifecycle instead of changing persistent Rex block labels.
