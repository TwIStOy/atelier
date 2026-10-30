# Changelog

## [Unreleased]

## [0.7.0] - 2026-10-30

### Added

- Initial port of pi-spark's recap feature: when the session has been idle (no agent activity, no editor input) for a configurable timeout, generates a 1-2 sentence recap of the session so far and renders it in a widget below the editor. Also available on demand via the `/recap` command. Configurable via `/config` (enabled, model, idle timeout).
