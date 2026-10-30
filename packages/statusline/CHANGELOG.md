# Changelog

## [Unreleased]

## [0.7.0] - 2026-10-30

### Breaking Changes

- Move the custom input editor, editor hints, and `borderColor` configuration to `extensions/better-editor`. Statusline now manages only the footer and turn telemetry; configure the editor under `/config` -> BetterEditor.

### Added

- Shell-style prompt in the editor body: the first line is prefixed with `❯ ` (accent color) and continuation lines get a matching 2-column hang indent, so wrapped text stays aligned under the first character. The gutter is drawn by `MyEditor` itself (inner editor uses `paddingX: 0`) because re-slicing the rendered line corrupts pi-tui's zero-width cursor marker downstream.
- `borderColor` config option (`/config` -> Statusline -> "Editor Border Color"): `Fixed dim` (default), `Fixed border color` (theme border role), or `Follow thinking level` for pi's built-in thinking-level colors.

### Changed

- Model labels and context usage now read Pi's session APIs directly after removal of the `virtual-model` extension.
- The editor border no longer follows the thinking level by default. Pi reapplies thinking-level colors on every level change, which overrode the constant border color `MyEditor` set at construction; the configured color is now re-asserted on every render. Bash mode keeps its dedicated border color.

### Removed

- Z.AI Coding Plan quota segment and its event subscription after removal of the `zai-coding-plan` extension.

## [0.4.0] - 2026-07-31

### Added

- Extension status segment in the footer: renders values set by any extension via `ctx.ui.setStatus()` (e.g. `agents-mirror`'s injection count) from `footerData.getExtensionStatuses()`. Toggle in `/config` -> Statusline -> "Show Extension Statuses" (default on). Lowest-priority segment, dropped first when the terminal is narrow.

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

### Removed

- Runtime detection segment (node/python/rust/... version in the footer), its `showRuntime` config item, `RuntimeComponent`, and tests. Footer no longer spawns version probes.

## [0.3.1] - 2026-07-30

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
