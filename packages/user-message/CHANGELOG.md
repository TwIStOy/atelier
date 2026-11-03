# Changelog

## [Unreleased]

### Changed

- Split the sticky-prompt scan (`getPinnedPrompt`) into bracket-search, bounds-trim, and preview-line helpers, and the jump-marker mouse handler into accept/press/click helpers; no behavior change.

## [0.7.0] - 2026-10-30

### Added

- Fullscreen transcripts pin the current turn's user prompt as its original block reaches the viewport top, without a partially clipped transition. The pinned block follows the viewed turn, reuses its rendered styling, and shows up to three lines with an ellipsis for longer prompts. It starts on the first viewport row and aligns with the original prompt's left edge; a clickable `▲` centered in the separator below jumps to the complete original user block. The pin yields to an approaching user block, dialogs, and text selection and is removed on session shutdown or reload.
- New TUI user messages are classified through System One into `flash`, `middle`, and `flagship` model tiers, with all three probabilities displayed in a muted row below the message. Classification runs in the background and does not switch models. Registers the shared System One configuration section, including its default model setting; requires a configured API key. Rendering and session replay do not trigger inference, and pending requests are cancelled on turn cancellation or session shutdown.

### Changed

- Reuse the common complexity assessment rubric shared with virtual model routing. Transcript scores remain display-only.
- Complexity classification now uses the current system prompt and the complete active conversation from the next `context` event, including full tool results and compaction or branch summaries. Image attachments retain type markers without forwarding image bytes. Repeated message text is classified separately for each turn, with results associated with the correct transcript row through rerenders, compaction, and tree navigation.

## [0.5.0] - 2026-08-12

### Fixed

- The user-prompt `▌` bar now maps the `max` thinking level to the `thinkingMax` theme color. The level switch predated the `max` level, so running at `max` fell through to the default `thinkingOff` and every prompt bar rendered gray.

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Initial release.
