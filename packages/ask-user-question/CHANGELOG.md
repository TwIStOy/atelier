# Changelog

## [Unreleased]

### Added

- RPC host native dialogs: when `ctx.mode === "rpc"`, the tool now drives `ctx.ui.select` (native dropdown for single-select, with option previews/descriptions folded into the title/options) and `ctx.ui.input` (comma-separated-index input for multi-select) per question, instead of silently declining via the unusable `ctx.ui.custom` slot. The answer envelope is identical to the TUI path. ([#103](https://github.com/TwIStOy/pi-extensions/issues/103))

### Changed

- Single-select option lists now wrap on UP/DOWN at the boundaries (last → first, first → last) instead of routing through the removed chat focus row.
- `formatAnswerScalar` no longer takes a `variant` argument; the only variant-differing branch (chat) is gone, so summary and envelope now share one output path.
- Hosts with no interactive UI (`!ctx.hasUI`, i.e. JSON/print mode) now receive an explicit error instructing the model to ask the user in chat, replacing the generic "UI not available" message. ([#103](https://github.com/TwIStOy/pi-extensions/issues/103))

### Fixed

- RPC mode no longer fake-declines: previously `ctx.ui.custom` returned `undefined` in RPC, so every questionnaire looked like the user declined. RPC now uses the extension UI subprotocol's native dialogs. ([#103](https://github.com/TwIStOy/pi-extensions/issues/103))

### Removed

- Removed the "Chat about this" escape-hatch row from the questionnaire dialog (upstream v2.0.0 / commit `32520050` made the same removal). Esc is now the only way to abandon the dialog and continue in free-form conversation. Deleted the `chat` `WrappingSelectItem` variant, the `kind: "chat"` answer, the `chatFocused` state field, the `focus_chat` / `focus_options` actions, the standalone `ChatRowView` component, and the `CHAT_CONTINUATION_MESSAGE` / `CHAT_SUMMARY_MESSAGE` formatting ([#106](https://github.com/TwIStOy/pi-extensions/issues/106)).

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.3.1] - 2026-07-30

### Added

- Enabled strict JSON-schema constrained sampling (`constrainedSampling: { type: "json_schema", strict: "prefer" }`) on the `ask_user_question` tool. Providers that support strict tool schemas (Anthropic, OpenAI Responses, Gemini 3, Mistral, strict-capable Bedrock) now enforce the nested questions/options schema server-side; other models fall back to normal tool calling. Requires `@earendil-works/pi-coding-agent` 0.82.x.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Initial release.
