# Changelog

## [Unreleased]

### Added

- Initial skeleton for the `tool-call-fixer` extension. Registers a `tool_call` handler that mutates `event.input` in place to adjust suspicious arguments before the tool executes. Core is a pure `applyStrategies(toolName, input, config, strategies)` plus a `STRATEGIES` registry in `src/strategies/`. Config surface (`enabled`, `notifyOnStrategy`) via `@htwang-contrib/common`.
- First strategy: `param-name-repair` — renames mistyped/aliased parameter names to the schema-correct name (e.g. `read.file_path` -> `path`, effective `grep.glob` -> `include`) using the `PARAM_NAME_ALIASES` table in `src/strategies/param-name-repair.ts`. First matching alias wins; skips when the correct key is already present.
- Expanded `PARAM_NAME_ALIASES` with aliases sourced from upstream [`pi-tool-repair`](https://github.com/monotykamary/pi-tool-repair) (path aliases for `read`/`edit`/`write`/`grep`, plus `write.content`, `bash.command`, `grep.pattern`, `ls.path`). Deliberately excluded upstream `edit.oldText`/`newText` (our `edit` uses a nested `edits[]` shape — a structural-repair concern, not a top-level rename) and `find` (shadowed by `glob` in this setup).
- Added `glob` to `PARAM_NAME_ALIASES` (`pattern`, `path`). Verified against the effective tool set: pi's default active builtins are only `read`/`bash`/`edit`/`write`; `grep`/`glob`/`ls` come from `extra-tools` and builtin `find` is registered but inactive, so `glob` is the active file-find tool.
