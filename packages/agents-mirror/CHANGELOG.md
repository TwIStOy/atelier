# Changelog

## [Unreleased]

### Removed

- Dead exports found by static analysis: `MirrorResolution`, `InjectionConfig`, `CONFIG_ID`, `defaultConfigPath`, `SINGLETON_SESSION_KEY`, `STATUS_KEY`, `WIDGET_KEY`, `Cache.clearAll()`.

## [0.7.0] - 2026-10-30

### Changed

- Injected directory context blocks now state which directory triggered the injection: `[Directory Context for <directory>: <file path>]`. For mirror-sourced files the directory shown is the corresponding project-side directory the rules apply to.

## [0.4.0] - 2026-07-31

### Added

- Initial `agents-mirror` extension: injects nested `AGENTS.md` from an external mirror directory (same structure as the project, agents.md only) plus the project's own nested `AGENTS.md` into `read` tool results.
- Inline chat entry (`agents-mirror:injected`) that renders a compact row in the chat body after each successful injection, not sent to the LLM. Toggle via the **Inline Chat Entry** setting (default on).

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

