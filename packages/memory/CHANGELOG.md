# Changelog

## [Unreleased]

### Changed

- Split the memory instructions injected into the system prompt: the always-on `<memory_instructions>` block now carries only policy (initialization sequence, recall triggers, write triggers and self-checks, pre-flight invariants, priority caps summary) at ~5.9k characters, down from ~19.7k. The mechanics (three-layer architecture, tool catalog, URI grammar, create/update decision tables, behavior-anchor record format, priority slotting and cap-cascade flow, disclosure and alias rules, merge/dedup/split rules, audit procedures) moved to `src/prompts/memory-reference.md`, injected by absolute-path pointer and read on demand before the first write of a session, structural operations, and audits.

## [0.7.0] - 2026-10-30

### Added

- Aggregate rules for the read-only `memory-*` and `journal-*` tools (`memory-read`, `memory-search`, `memory-list`, `memory-history`, `memory-domains`, `journal-read`, `journal-search`), so consecutive calls collapse into one verb-group summary line (e.g. `Read 2 memories, Searched 1 memory`) in tool-display. Write operations (`memory-create`, `memory-update`, …) stay unregistered, matching the built-in edit/write boundary.
- All memory and journal tools declare MCP-style annotations: read tools are read-only; `memory-update` / `memory-delete` / `memory-alias` / `memory-triggers` are destructive and idempotent; `memory-create` / `journal-write` only add data.

## [0.6.0] - 2026-08-19

### Changed

- System-prompt appendix now registers through `@htwang-contrib/common`'s contribution registry (`priority` 200, see `docs/common/SYSTEM-PROMPT-PRIORITIES.md`) instead of returning `{ systemPrompt }` from `before_agent_start`.

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
