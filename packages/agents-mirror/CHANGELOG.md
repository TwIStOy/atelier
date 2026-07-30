# Changelog

## [Unreleased]

### Added

- Initial `agents-mirror` extension: injects nested `AGENTS.md` from an external mirror directory (same structure as the project, agents.md only) plus the project's own nested `AGENTS.md` into `read` tool results.
- Inline chat entry (`agents-mirror:injected`) that renders a compact row in the chat body after each successful injection, not sent to the LLM. Toggle via the **Inline Chat Entry** setting (default on).
