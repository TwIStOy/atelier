# Changelog

## [Unreleased]

### Fixed

- Keep the ModelRegistry private-runtime bridge and its test fixture compatible with Pi 0.99.1 declarations without intersecting conflicting private fields.
- `hide-models` filters models again on pi ≥0.85. The patch now wraps `ModelRuntime.prototype.getAvailableSnapshot`/`getAvailable` (the surface the model picker, `pi --list-models`, and RPC model lists actually read) instead of `ModelRegistry.prototype`, which pi turned into an extension-facing compatibility facade that no internal consumer calls — rules silently stopped filtering anything after the pi upgrade. The runtime `suppress` flag (`/hide-models reset`) now lives on the prototype instead of module state, so it keeps working after `/reload` re-evaluates the extension module. A shape canary test fails loudly if pi renames the runtime accessors again.

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Double-Escape to Abort streaming. While the LLM is streaming, the first Escape arms a debounce window and shows an `esc again to abort` hint instead of aborting; a second Escape within the window aborts the response. If the window expires the hint clears and Escape resets. While not streaming, Escape aborts immediately (no debounce), and autocomplete dismissal always takes a single Escape. The hint is published on the shared `EDITOR_HINT_EVENT` channel (`@htwang-contrib/common`) so the editor-owning extension (e.g. `statusline`) renders it into its own border; the intercept itself monkey-patches the inner editor's `handleInput` to catch the `app.interrupt` keybinding. Toggle via `/config` -> experience (`Double-Escape to Abort`) and tune the window via `Double-Escape Window (ms)` (200-2000, default 600).
- `hide-models` command and model-hiding patch. Hide providers or specific models from the model picker via `/hide-models add|remove|reset|help`, or visually via `/config` -> experience (dynamic multiselect). Hiding works by patching `ModelRegistry.prototype.getAvailable`/`getAll` to filter models matching the persisted rules; the patch reads live config on every call so `/config` edits apply immediately. `reset` temporarily unpatches at runtime (all models visible) and rules re-apply on reload.

### Changed

- `double-escape` no longer replaces the active editor. It now wraps the currently registered editor factory via `chainEditorFactory` (`@htwang-contrib/common`) and only layers Escape interception on top, so it composes with other custom editors such as `statusline`'s `MyEditor` (rounded border, model/context/cost/cwd labels) instead of clobbering it. The standalone `DoubleEscapeEditor`/`abort-editor.ts` were removed; the debounce state machine in `state-machine.ts` is unchanged.
