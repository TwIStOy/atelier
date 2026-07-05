# Changelog

## [Unreleased]

### Fixed

- The `/config` popup now caps its height at 85% of the terminal (the existing `DEFAULT_MAX_HEIGHT` constant), instead of ignoring it and growing to `terminalRows - 2`. On short terminals the popup previously grew tall enough to push its title row off the top of the viewport; the title and footer now stay visible. The 85% value is derived from a single `DEFAULT_MAX_HEIGHT_PCT` source so future tuning changes take effect.
