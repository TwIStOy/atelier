# Changelog

## [Unreleased]

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Fixed

- The Goal status bar running time now ticks live while a goal is active instead of staying frozen between turns. The widget recomputes elapsed time from `lastStartedAt` on every render and requests a re-render once per second.
- The elapsed time shown when a goal completes now includes the in-progress interval. Previously `timeUsedSeconds` was only accumulated at `agent_end` / `session_shutdown`, so completing a goal mid-turn dropped the time spent during the finishing turn.
- Elapsed time now only advances while the session is live. Resuming an active goal after the session was closed rebases the timer to now instead of silently counting the offline gap as run time.

### Changed

- Goal time accounting is unified on `lastStartedAt`. `timeUsedSeconds` holds accumulated closed intervals; the live active interval is derived from `lastStartedAt` and folded in on pause / completion / budget-limit / shutdown. Token accounting and the budget-limited transition are unchanged.
