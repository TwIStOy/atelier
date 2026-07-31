# Changelog

## [Unreleased]

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.3.1] - 2026-07-30

### Added

- Enabled strict JSON-schema constrained sampling (`constrainedSampling: { type: "json_schema", strict: "prefer" }`) on the `ask_user_question` tool. Providers that support strict tool schemas (Anthropic, OpenAI Responses, Gemini 3, Mistral, strict-capable Bedrock) now enforce the nested questions/options schema server-side; other models fall back to normal tool calling. Requires `@earendil-works/pi-coding-agent` 0.82.x.

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Initial release.
