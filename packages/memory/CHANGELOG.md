# Changelog

## [Unreleased]

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.2.6] - 2026-07-16

### Changed

- Disabled proactive auto-recall system-prompt injection. Matching/`recall-index` helpers remain in source but no longer run on `before_agent_start`; memory tools still rely on explicit `memory-search` / `memory-read`.

### Added

- Proactive auto-recall helpers (`recall.ts`: disclosure match against cwd/prompt, capped `<recalled_memory>` block). Currently disabled at the extension entrypoint — not injected into the system prompt.
- Rewrote the memory prompt's recall section ("Recall BEFORE You Answer"): forceful, observable triggers (on the request, not guesses about memory), multi-search guidance for multi-part questions, and a proactive nudge in the `memory-search` tool description.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Changed

- All memory/journal tools now honor the agent abort signal: pressing interrupt (`esc`) while a `memory-*` or `journal-*` tool is running now kills the underlying `hat` subprocess and stops the call immediately, instead of waiting for it to finish.
