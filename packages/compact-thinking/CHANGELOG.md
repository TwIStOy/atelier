# Changelog

## [Unreleased]

### Changed

- The "... (N more lines, key to expand)" truncation hint now renders on the same line as the heading (e.g. `Thought for 8s ... (7 more lines, ctrl+t to expand)`) instead of taking its own line.

### Added

- The compact thinking block now renders a `▌` gutter bar (theme color `borderMuted`, deliberately distinct from the user-prompt bar's thinking-level palette) in the 2-column indent, spanning the heading and preview lines.
- The expanded thinking block (thinking toggled visible) is now indented by 2 columns as well, matching the compact block's indentation. Implemented by bumping `paddingX` on the stock thinking `Markdown` children after delegating to the original renderer, so stock markdown transforms and streaming behavior are preserved.
- The compact thinking block (heading and preview lines) is now indented by 2 columns relative to regular assistant text, visually separating it from surrounding content.
- Initial release. Ported from [pi-compact-thinking](https://github.com/nostalfinals/pi-compact-thinking) with OpenAI Responses summary-title support removed. Configuration uses the shared ConfigItem mechanism (`/config`, persisted to `~/.config/pi/extensions.json`) instead of a standalone JSON file.
