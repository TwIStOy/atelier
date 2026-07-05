# Changelog

## [Unreleased]

### Added

- `hide-models` command and model-hiding patch. Hide providers or specific models from the model picker via `/hide-models add|remove|reset|help`, or visually via `/config` -> experience (dynamic multiselect). Hiding works by patching `ModelRegistry.prototype.getAvailable`/`getAll` to filter models matching the persisted rules; the patch reads live config on every call so `/config` edits apply immediately. `reset` temporarily unpatches at runtime (all models visible) and rules re-apply on reload.
