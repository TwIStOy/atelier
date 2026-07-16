# Changelog

## [Unreleased]

### Added

- Proactive auto-recall: on each turn the extension fetches a flat recall index (`hat memory recall-index`, single bulk query against the denormalized `search_cache`) and injects memories whose disclosure matches the current project (cwd) or prompt topic. Project match uses single-token overlap; topic match requires 2+ token overlap to stay precise. Results are deduped, sorted by priority, capped at 8, and injected as a `<recalled_memory>` block. Best-effort and non-blocking; silently no-ops when `hat` lacks the `recall-index` subcommand.
- Rewrote the memory prompt's recall section ("Recall BEFORE You Answer"): forceful, observable triggers (on the request, not guesses about memory), multi-search guidance for multi-part questions, and a proactive nudge in the `memory-search` tool description.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Changed

- All memory/journal tools now honor the agent abort signal: pressing interrupt (`esc`) while a `memory-*` or `journal-*` tool is running now kills the underlying `hat` subprocess and stops the call immediately, instead of waiting for it to finish.
