# Changelog

## [Unreleased]

### Changed

- Model-specific appendix now registers through `@htwang-contrib/common`'s contribution registry (`priority` 300, `mode: "replace"`, see `docs/common/SYSTEM-PROMPT-PRIORITIES.md`) instead of returning `{ systemPrompt }` from `before_agent_start`. Session-level rule cache (`session_start` / `model_select`) is unchanged. Rules may now set `replaceFirstLine` as well as `prompt`.

### Added

- `deepseek-v4` rule: on `deepseek-v4-flash` / `deepseek-v4-pro`, replace the first system-prompt line (Pi's persona) with `You are a helpful software engineer assistant. When you think, think in ENGLISH, start with "We need..".`.
- Initial `inject-prompt-by-model` extension. On `before_agent_start`, builds a `<provider>/<modelId>` target from `ctx.model`, matches it against the ordered, hardcoded `MODEL_PROMPT_RULES` regex list aggregated in `src/rules/index.ts` (one file per rule under `src/rules/`), and appends every matching rule's `prompt` to the system prompt in fixed registration order (byte-stable across turns for prompt caching). Ships with one rule: `kimi-k3` models are told to never write scripts to modify source code and to always use the `edit` tool directly. Master kill-switch via `isExtensionDisabled("inject-prompt-by-model")`. The rule decision is made once per session (`session_start`) and re-evaluated on `model_select`; `before_agent_start` only re-applies the cached prompt (pi resets the system prompt to base when no extension returns one, so the cached value must be returned every turn). A rule application raises an info notification once per model target.
