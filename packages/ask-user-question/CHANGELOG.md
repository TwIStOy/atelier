# Changelog

## [Unreleased]

## [0.5.0] - 2026-08-12

### Added

- RPC host native dialogs: when `ctx.mode === "rpc"`, the tool now drives `ctx.ui.select` (native dropdown for single-select, with option previews/descriptions folded into the title/options) and `ctx.ui.input` (comma-separated-index input for multi-select) per question, instead of silently declining via the unusable `ctx.ui.custom` slot. The answer envelope is identical to the TUI path. ([#103](https://github.com/TwIStOy/pi-extensions/issues/103))
- The `ask_user_question` tool is now hidden from the model in non-interactive runs (print/json modes). A `before_agent_start` reconcile strips or restores the tool from the active set based on `ctx.hasUI`, so it no longer appears in the tool list and wastes a call that returns a `no_ui` error. The `!hasUI` guard inside `execute` stays as a backstop. ([#102](https://github.com/TwIStOy/pi-extensions/issues/102))
- Emit a paired `ask_user_question:blocked` event (`{ active: boolean }`) around the questionnaire interaction so external state listeners (e.g. `moshi-hooks-extra`) can flip a session from "working" to "blocked". The event contract (`ASK_USER_BLOCKED_EVENT` / `AskUserBlockedPayload`) is defined in `@htwang-contrib/common` alongside `MODAL_ACTIVE_EVENT` and `ASK_USER_PROMPT_EVENT`. `{ active: true }` fires before the questionnaire runs (both the TUI `ctx.ui.custom` path and the RPC native-dialog path) and `{ active: false }` in the `finally`, so cancel and UI-throw paths clear it too. ([#105](https://github.com/TwIStOy/pi-extensions/issues/105))
- Ctrl+G (`app.editor.external`) in the custom-answer row opens Pi's configured external editor on the current draft; on save+exit the edited text replaces the draft. No-change / failed launch preserves the existing draft and questionnaire state. Borrows the `editWithExternalEditor` flow from upstream rpiv-mono `15fe9ba8`; the edited value persists into `customDraftsByTab` like an inline edit. The editor-slot `tui.stop()/start()` restore path is unit-tested with a mock TUI and still needs manual TTY verification ([#100](https://github.com/TwIStOy/pi-extensions/issues/100)).

### Changed

- Single-select option lists now wrap on UP/DOWN at the boundaries (last → first, first → last) instead of routing through the removed chat focus row.
- `formatAnswerScalar` no longer takes a `variant` argument; the only variant-differing branch (chat) is gone, so summary and envelope now share one output path.
- Hosts with no interactive UI (`!ctx.hasUI`, i.e. JSON/print mode) now receive an explicit error instructing the model to ask the user in chat, replacing the generic "UI not available" message. ([#103](https://github.com/TwIStOy/pi-extensions/issues/103))
- Notes (`n`) are now available on every question tab — single- and multi-select, with or without an option preview. The controls hint advertises `n to add notes` everywhere except `inputMode`. ([#101](https://github.com/TwIStOy/pi-extensions/issues/101))

### Fixed

- RPC mode no longer fake-declines: previously `ctx.ui.custom` returned `undefined` in RPC, so every questionnaire looked like the user declined. RPC now uses the extension UI subprotocol's native dialogs. ([#103](https://github.com/TwIStOy/pi-extensions/issues/103))
- Preview questionnaires now rebalance after terminal resizing: option descriptions gain usable width without exceeding half the dialog, while content-sized previews align with the right edge of their column ([#104](https://github.com/TwIStOy/pi-extensions/issues/104)).
- Notes written without confirming an option no longer vanish on reopen or tab switch. Unconfirmed drafts persist in a `notesByTab` side-band and take priority over a confirmed answer's notes when re-entering the editor; clearing the draft now also strips the notes from the confirmed answer. ([#101](https://github.com/TwIStOy/pi-extensions/issues/101))
- Custom-text drafts typed in the "Type something." row are now preserved across option navigation and isolated per question, instead of being cleared on nav and leaking across questions via the shared inline-input buffer ([#98](https://github.com/TwIStOy/pi-extensions/issues/98)).

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
