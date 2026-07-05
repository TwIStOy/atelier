# Changelog

## [Unreleased]

### Added

- Double-Escape to Abort streaming. While the LLM is streaming, the first Escape arms a debounce window and shows an `esc again to abort` hint on the editor border instead of aborting; a second Escape within the window aborts the response. If the window expires the hint clears and Escape resets. While not streaming, Escape aborts immediately (no debounce), and autocomplete dismissal always takes a single Escape. Implemented as a `CustomEditor` subclass intercepting the `app.interrupt` keybinding with an injectable debounce state machine. Toggle via `/config` -> experience (`Double-Escape to Abort`) and tune the window via `Double-Escape Window (ms)` (200-2000, default 600).
- `hide-models` command and model-hiding patch. Hide providers or specific models from the model picker via `/hide-models add|remove|reset|help`, or visually via `/config` -> experience (dynamic multiselect). Hiding works by patching `ModelRegistry.prototype.getAvailable`/`getAll` to filter models matching the persisted rules; the patch reads live config on every call so `/config` edits apply immediately. `reset` temporarily unpatches at runtime (all models visible) and rules re-apply on reload.
