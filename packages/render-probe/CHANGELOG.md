# Changelog

## [Unreleased]

### Added

- `render-probe` diagnostic command: patches `Container.prototype.render` to measure per-frame render cost (avg/p50/p95/max ms, lines per frame) with a per-component time breakdown, to pinpoint whether editor lag is render-bound and which component class dominates. `/render-probe start | stop | report`; full report written to `/tmp/render-probe-<pid>.log`.
