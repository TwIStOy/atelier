# Changelog

## [Unreleased]

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
