# Changelog

## [Unreleased]

### Added

- The thinking gutter bar now plays a per-row brightness wave while a thinking run is active, modeled on grok-build's accent rail: each row's color is a `sin²(tick·speed + row/32·2π)` lerp between `borderMuted` (trough, so the bar never disappears) and a peak role resolved through `text` → `muted` → `thinkingText` (so themes that leave `text` empty — terminal default fg, e.g. catppuccin-mocha — still animate), with a ~1.4s period regardless of the configured animation interval. The spatial wavelength is fixed at 32 rows like grok-build, so adjacent rows differ by at most `amplitude·sin(π/16)` ≈ 19.5% of the color range; the amplitude itself scales with the widget's row count (`min(1, rows/13)`) so short blocks stay subtle and tall blocks reach the full peak. Finished runs keep the static `borderMuted` bar, and themes without color accessors fall back to the static bar.
- Compact thinking blocks are now click-expandable per block. Each rendered thinking run is wrapped in a `MouseRegion`; a left click toggles that single run between the compact preview (or summary) and the full raw thinking text, leaving other runs untouched. The collapsed truncation hint now reads `... (N more lines, click or ctrl+t to expand)` and the expanded view ends with `... (click to collapse)`; expanding a summarized run shows the original thinking, not the summary. Per-run expansion state resets when the global thinking visibility is toggled (ctrl+t), matching the stock component's override reset.

### Fixed

- The animation tick no longer rebuilds streaming thinking components every frame. Each `updateContent` constructs a fresh `StrictThinkingPreview` with a cold wrap cache, so rebuilding at 45ms re-wrapped the entire (growing) thinking text twice as often as before and starved delta rendering — thinking text visibly arrived in bursts. The gutter wave now reads the animation frame lazily at render time (`createWaveBar` takes a `() => number`), so a plain `requestRender()` animates it; full `updateContent` rebuilds (needed for the heading highlight and duration) only run every other tick, restoring the previous 90ms cadence.

### Changed

- The default `animationIntervalMs` is now 45 (was 90), closer to grok-build's 33ms/0.15rad-per-tick cadence — the 90ms tick made the wave visibly steppy. The heading highlight animation shares the tick and is correspondingly smoother.
- Dev dependencies bumped to `@earendil-works/pi-tui`, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-ai` `^0.85.0` (`MouseRegion` and mouse dispatch landed in pi-tui 0.84.2+; the stock `Markdown.paddingX` became private in 0.85.1, so the expanded-thinking indent now sets it through the internals cast). npm hoisted `pi-coding-agent` 0.85.1 to the root `node_modules` for all workspaces as a side effect.

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
