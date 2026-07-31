# Changelog

## [Unreleased]

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Initial skeleton for the `tool-call-fixer` extension. Registers a `tool_call` handler that mutates `event.input` in place to adjust suspicious arguments before the tool executes. Core is a pure `applyStrategies(toolName, input, config, strategies)` plus a `STRATEGIES` registry in `src/strategies/`. Config surface (`enabled`, `notifyOnStrategy`) via `@htwang-contrib/common`.
- First strategy: `param-name-repair` — renames mistyped/aliased parameter names to the schema-correct name (e.g. `read.file_path` -> `path`, effective `grep.glob` -> `include`) using the `PARAM_NAME_ALIASES` table in `src/strategies/param-name-repair.ts`. First matching alias wins; skips when the correct key is already present.
- Expanded `PARAM_NAME_ALIASES` with aliases sourced from upstream [`pi-tool-repair`](https://github.com/monotykamary/pi-tool-repair) (path aliases for `read`/`edit`/`write`/`grep`, plus `write.content`, `bash.command`, `grep.pattern`, `ls.path`). Deliberately excluded upstream `edit.oldText`/`newText` (our `edit` uses a nested `edits[]` shape — a structural-repair concern, not a top-level rename) and `find` (shadowed by `glob` in this setup).
- Added `glob` to `PARAM_NAME_ALIASES` (`pattern`, `path`). Verified against the effective tool set: pi's default active builtins are only `read`/`bash`/`edit`/`write`; `grep`/`glob`/`ls` come from `extra-tools` and builtin `find` is registered but inactive, so `glob` is the active file-find tool.
- Phase 2 validate-then-repair strategy `shape-repair` (`src/strategies/shape-repair.ts`) plus a schema module `src/schemas.ts` (`TOOL_SCHEMAS` for the effective tools + `validateToolInput`). Validates the input against our own schemas, then applies path-scoped repair rules only at failed paths: `dropNullOrUndefined`, `dropEmptyObjectPlaceholder`, `parseJsonStringifiedArray`, `wrapBareStringAsArray` (`src/strategies/shape-repair-rules.ts`). Schemas come from `docs/tool-call-fixer/tool-schemas.md`, not upstream's `BUILTIN_SCHEMAS` (which differ). Runs after `param-name-repair` so the validator sees corrected field names. Validation is top-level only for now (nested `edit.edits[].oldText/newText` repair is a future strategy).
- Root-level repair `wrapRootStringAsObject`: a bare-string tool input (e.g. `read("/etc/hosts")`) is wrapped as `{field: string}`. Wired in the `tool_call` handler (not as a strategy) because it must replace `event.input` rather than mutate it in place.
- Phase 1.5 phantom-tool-use normalization (`src/phantom-tool-use.ts`) on `message_end`: when an assistant message has `stopReason: "toolUse"` but no `toolCall` content blocks (a vLLM/z.ai failure mode), normalize to `stopReason: "error"` with an explanatory message so the turn exits cleanly instead of hanging. Gated by the master `enabled` flag.
- Phase 1 grammar-leak repair (`src/grammar-repair/`) on `message_end`, GLM-first: detects leaked GLM `arg_key`/`arg_value` grammar emitted as assistant text, strips it, and (in `recover` mode) appends recovered `toolCall` blocks + sets `stopReason: "toolUse"`. Safety gates: defaults OFF, `requireKnownTool` (only recovers names in the active tool registry via `pi.getActiveTools()`), ignores fenced code blocks, skips empty-argument calls, and does not duplicate when the provider already emitted native `toolCall` blocks. Config (`grammarRepairEnabled`, `grammarRepairMode`, `grammarRepairRequireKnownTool`) surfaced via ConfigItems, not upstream's JSON file. Ported framework + GLM parser with an extensible `GRAMMAR_PARSERS` registry; other families (DSML/Qwen/Kimi/...) are additive future work per the porting rules.
- Added Qwen and Kimi grammar families to `GRAMMAR_PARSERS`. Qwen (JSON variant): recovers `<tool_call>{"name":...,"arguments":...}</tool_call>` (single object or array, `<tools>` wrapper, markdown-fenced) via shared JSON helpers (`callFromJsonObject`/`normalizeArgumentsObject`/`extractFirstBalancedJson`). Kimi: recovers `<|tool_calls_section_begin|>...<|tool_call_begin|>functions.<name>:<n><|tool_call_argument_begin|>{json}<|tool_call_end|>...<|tool_calls_section_end|>`. Covers Qwen/Hermes and Kimi models alongside GLM. Attribute-tag families (DSML/DeepSeek, Qwen `<function>`/`<parameter>` XML, MiniMax `<invoke>`) are deferred — their `<tag attr=...>` regexes were stripped by the web fetch and need a clean raw source read before porting.
- Split `src/grammar-repair.ts` into a `src/grammar-repair/` module: `types.ts` (shared types), `shared.ts` (JSON/text/candidate helpers), `parsers/{glm,qwen,kimi}.ts` (one file per family), `parsers/index.ts` (`GRAMMAR_PARSERS` registry — the extension point), `repair.ts` (orchestration), `index.ts` (public re-exports). Behavior unchanged (83 tests still pass). Adding a new family = new `parsers/<name>.ts` + one line in `parsers/index.ts`.
