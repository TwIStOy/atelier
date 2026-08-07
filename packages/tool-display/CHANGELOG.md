# Changelog

## [Unreleased]

### Changed

- The extension now only activates in TUI mode. All TUI-specific setup (config item registration, `ToolExecutionComponent` render patching, theme capture) is deferred to `session_start` and guarded by `ctx.mode === "tui"`, so running under `--mode rpc`/`json`/`print` no longer patches the component prototype or registers config items. The cross-extension `tool-display:register`/`tool-display:ready` event bus stays active in every mode so adapter registration keeps working.

### Added

- `workflow` tool display adapter: the `Workflow` tool row now matches the Read/Bash/Subagent styling. The header shows the workflow's `meta.name` (parsed from the script with the shared acorn parser via `@htwang-contrib/workflow/script`, falling back to the first script line) plus live `settled/total agents` stats. While the run is in flight the collapsed view renders per-agent rows (`├`/`└` branches, spinner/✓/✗/◌/– status glyphs, tool-call counts, error details) from the run snapshot in `details.workflow`; once finished it collapses to the standard truncated output preview (tail lines + "more lines" expand hint). The expanded view renders the full script with syntax-highlighted line numbers, followed by the full output summary. `tool-call-display.ts` now treats `workflow` like `subagent` for adapter gating (collapsed rows render from details even before text output exists) and derives the header status icon from `details.ok`.

### Fixed

- The patched `ToolExecutionComponent.render` now prepends the blank separator line that the stock component renders via its leading `Spacer(1)` child. The override bypassed the container's children entirely, so tool call rows were glued directly to the preceding assistant text or compact thinking block with no empty line in between.
- Multi-task `Subagent` tool calls no longer crash pi on narrow terminals. The per-task and batch summary rows in the collapsed tool display now truncate the task description against the terminal width (width- and ANSI-aware via `truncateToWidth`/`visibleWidth`) and apply a safety-net truncation so no rendered row can exceed the terminal width. Previously the description was capped at a fixed 56 characters and the composed row was never bounded, producing lines wider than the terminal and triggering `Rendered line exceeds terminal width`.

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.2.5] - 2026-07-14

### Added

- Tool calls now show an elapsed-time label between the status icon and the tool name. Durations under 3s render as milliseconds (e.g. `123 ms`), 3s-90s as seconds with two decimals (e.g. `4.20s`), and 90s+ as `m:ss` (e.g. `1:30`). The timer ticks live while running and freezes at the final duration once the call completes.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Breaking Changes

- Removed the `bashCommandDisplayLength` config item from the Tool Display extension. It only controlled the floor for command *truncation*, and the Bash header now wraps the command onto continuation lines instead of truncating, so the knob no longer has any effect ([#11](https://github.com/TwIStOy/pi-extensions/issues/11)).

### Fixed

- The Bash tool header now wraps long commands onto continuation lines instead of truncating them with an ellipsis, so the full command stays visible in every state (partial, collapsed, expanded, errored). Continuation lines are aligned under the command start, and the description and `in <cwd>` suffix remain visible ([#11](https://github.com/TwIStOy/pi-extensions/issues/11)).
- Fixed the error icon being repeated on every wrapped line of a tool's error reason when the tool call failed and was expanded. The icon now appears only on the first line, with continuation lines aligned by padding ([#9](https://github.com/TwIStOy/pi-extensions/issues/9)).
- Fixed the Bash tool header truncating the command at a fixed point and dropping the `in <cwd>` suffix. The command now fills the available terminal width and is truncated cleanly so the description and working-directory suffix stay visible ([#8](https://github.com/TwIStOy/pi-extensions/issues/8)).
