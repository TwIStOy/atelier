# Changelog

## [Unreleased]

### Changed

- Behavior-preserving refactor: `instrumentedRender` split into child-render/frame-record helpers and the `/render-probe` command dispatch split per subcommand.

## [0.5.0] - 2026-08-12

### Added

- `render-probe` diagnostic command: patches `Container.prototype.render` to measure per-frame render cost (avg/p50/p95/max ms, lines per frame) with a per-component time breakdown, to pinpoint whether editor lag is render-bound and which component class dominates. `/render-probe start | stop | report`; full report written to `/tmp/render-probe-<pid>.log`.
