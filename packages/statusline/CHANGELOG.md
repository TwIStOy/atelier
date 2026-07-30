# Changelog

## [Unreleased]

## [0.2.7] - 2026-07-30

### Added

- Turn telemetry notification: after each agent run settles, the statusline shows a one-line summary (TPS, TTFT, duration, tokens, stalls, cost-per-million) via `ctx.ui.notify`. Toggle in `/config` -> Statusline -> "Turn Telemetry" (default on). Powered by `TurnTelemetryTracker` from `@htwang-contrib/common`.
- Runtime detection segment in the footer: detects the project runtime (node, python, rust, go, ruby, deno, bun, php, swift, kotlin, java, c/cpp, dotnet, elixir, haskell, dart, zig, julia, nix, terraform, and more) from manifest files and shows its version. Version is fetched once per runtime with a 2.5s timeout and cached. Toggle in `/config` -> Statusline -> "Show Runtime" (default on).

### Changed

- Footer now lays out segments by priority via `fitSegmentsByPriority` (`@htwang-contrib/common`): when the terminal is narrow, the lowest-priority segments (runtime, git) drop first instead of the whole line being hard-truncated. Segment priorities: tokens > coding-plan usage > git/runtime.
- Git footer status now uses a single `git status --porcelain=v1 --branch --show-stash` call and parses ahead/behind, detached HEAD, and stash/working-tree state. Display now shows ahead (`↑N`) / behind (`↓N`) next to the branch; the `✓`/`✗` clean/dirty marker is unchanged.

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
