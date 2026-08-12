# Changelog

## [Unreleased]

### Added

- Initial `inject-prompt-by-model` extension. On `before_agent_start`, builds a `<provider>/<modelId>` target from `ctx.model`, matches it against the ordered, hardcoded `MODEL_PROMPT_RULES` regex list in `src/rules.ts`, and appends the first matching rule's `prompt` to the system prompt for that turn. Ships with an empty rule list; add entries in source. Master kill-switch via `isExtensionDisabled("inject-prompt-by-model")`.
