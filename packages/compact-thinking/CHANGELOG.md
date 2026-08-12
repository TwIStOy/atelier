# Changelog

## [Unreleased]

## [0.5.0] - 2026-08-12

### Added

- Optional thinking summaries: when enabled (`Summary Enabled` config item), each finished thinking run is sent to a configurable side model (`Summary Model`, empty = session model) for a one-line summary via `executeSideCall`. The summary replaces the raw thinking preview in the compact block once it arrives; expanding thinking still shows the original content. Summaries are persisted as session entries and restored on session load, mirroring the duration entries.
- Summary display is prefixed with `✦ Summary:` so summarized blocks are clearly distinguishable from raw thinking previews, and only runs longer than `Summary Min Chars` (default 2000) are summarized.
- While a summary side-call is in flight, the finished thinking block's heading shows an animated `[ Summarizing... ]` indicator (e.g. `Thought for 9s [ Summarizing... ]`); the animation timer now stays alive until all pending summaries settle.

### Fixed

- The thinking animation `setInterval` no longer starts in non-TUI modes (print/json), where it previously spun headlessly for the whole session doing no-op work. Component refresh and the render loop are now gated on the session being a TUI session; duration entry recording still runs in all modes.
- `StrictThinkingPreview.render` re-wrapped the entire thinking text via a fresh `Text` component on every frame for every assistant message, dominating transcript frame time (~5-30ms per message per frame, ~90% of total render cost in a measured session). The rendered lines are now memoized per width and dropped on `invalidate`.

### Changed

- The compact thinking block now leaves a blank line between the heading (`Thought for Xs`) and the preview/summary lines below it; the gutter bar stays continuous across the blank line.
- The "... (N more lines, key to expand)" truncation hint now renders on the same line as the heading (e.g. `Thought for 8s ... (7 more lines, ctrl+t to expand)`) instead of taking its own line.

### Added

- The compact thinking block now renders a `▌` gutter bar (theme color `borderMuted`) in the 2-column indent, spanning the heading and preview lines.
- The expanded thinking block (thinking toggled visible) is now indented by 2 columns as well, matching the compact block's indentation. Implemented by bumping `paddingX` on the stock thinking `Markdown` children after delegating to the original renderer, so stock markdown transforms and streaming behavior are preserved.
- The compact thinking block (heading and preview lines) is now indented by 2 columns relative to regular assistant text, visually separating it from surrounding content.
- Initial release. Ported from [pi-compact-thinking](https://github.com/nostalfinals/pi-compact-thinking) with OpenAI Responses summary-title support removed. Configuration uses the shared ConfigItem mechanism (`/config`, persisted to `~/.config/pi/extensions.json`) instead of a standalone JSON file.
