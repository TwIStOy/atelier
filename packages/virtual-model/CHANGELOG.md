# Changelog

## [Unreleased]

### Added

- Register `virtual/auto` through Pi's virtual model API, routing by request complexity across configurable `flash`, `middle`, and `flagship` chat models.
- Configurable judge model supports Pi classifier providers such as TypeSafe Jev and ordinary chat models, with full conversation context, cancellation, and a bounded decision timeout.
- Persist a session-wide tier floor that survives reload, resume, compaction, model reselection, and tree navigation. Retries and direct calls retain the floor; new sessions start from flash.
- Publish the active tier, physical model, and effective thinking level for statusline and context consumers. Direct summary calls leave the conversation display unchanged.

### Changed

- Initialize Auto's context/output limits from Flash, restore the persisted tier on resume, and update metadata to each chosen physical model before dispatch instead of advertising unknown limits.
