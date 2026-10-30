# Changelog

## [Unreleased]

## [0.7.0] - 2026-10-30

### Added

- Initial port of the Codex-style `apply_patch` tool from [`code-yeongyu/pi-apply-patch`](https://github.com/code-yeongyu/pi-apply-patch) (MIT). Registers a freeform grammar tool for OpenAI GPT-family models and swaps out the built-in `edit`/`write` tools while a GPT model is active. The tool is only registered once a GPT-family model has actually been active in the session (lazy registration; pi has no `unregisterTool`, so it registers at most once per extension instance and is kept out of the active toolset for non-GPT models). Patch parsing, fuzzy chunk application, atomic writes, per-file mutation queues, failure recovery instructions, and per-file unified-diff previews match upstream behavior; the grammar is exposed through pi's `constrainedSampling` API instead of upstream's `freeform` property. Display is handled by the `apply_patch` adapter in `@htwang-contrib/tool-display`.
- `apply_patch` declares MCP-style annotations (mutating, destructive, non-idempotent).
