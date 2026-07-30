# Changelog

## [Unreleased]

## [0.3.1] - 2026-07-30

### Added
- Populate the new `agent` and `title` Report fields. `agent` is always `"pi"`;
  `title` is the session name (else the first user prompt), omitted when unknown.

## [0.1.0] - 2026-07-22

### Added

- Initial release. Pushes full-state session Reports to the `htw daemon`
  producer HTTP API (`POST /v1/reports`) so live pi sessions show up in the
  `htw agents` dashboard.
